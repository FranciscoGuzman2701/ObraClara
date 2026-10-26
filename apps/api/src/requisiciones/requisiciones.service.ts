import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  CrearRequisicionInput, LineaRequisicionInput, ResultadoValidacion, ValidarLineaInput,
} from '@obraclara/contracts';
import { DbService, Tenant } from '../db/db.service';
import { exigirRol } from '../common/roles';

const CAPTURAN = ['CABO', 'RESIDENTE', 'GERENTE_OBRA'] as const;
const APRUEBAN = ['RESIDENTE', 'GERENTE_OBRA'] as const;
const AUTORIZAN_EXCEPCION = ['GERENTE_OBRA'] as const; // + DIRECTOR implícito

export interface RequisicionCreada {
  id: string;
  folio: string;
  duplicado: boolean;
}

@Injectable()
export class RequisicionesService {
  constructor(private readonly db: DbService) {}

  /** Semáforo de una línea sin crear nada (vista previa en web y app con señal). */
  validar(s: Tenant, input: ValidarLineaInput): Promise<ResultadoValidacion> {
    return this.db.tenant(s, async (c) => {
      const linea = await lineaDeControl(c, input.linea_control_id);
      await exigirRol(c, s.usuarioId, linea.obra_id, [...CAPTURAN, 'COMPRAS']);
      const { rows } = await c.query<ResultadoValidacion>(
        'SELECT resultado, detalle FROM fn_validar_linea_requisicion($1, $2, $3)',
        [input.linea_control_id, input.cantidad, input.precio_estimado],
      );
      return rows[0];
    });
  }

  crear(s: Tenant, input: CrearRequisicionInput): Promise<RequisicionCreada> {
    return this.db.tenant(s, (c) => this.crearEnTx(c, s, input.obra_id, input));
  }

  /** Reutilizado por /sync/push dentro de su propia transacción. */
  async crearEnTx(
    c: PoolClient, s: Tenant, obraId: string,
    input: { client_uuid?: string; fecha_requerida?: string; lineas: LineaRequisicionInput[] },
  ): Promise<RequisicionCreada> {
    await exigirRol(c, s.usuarioId, obraId, [...CAPTURAN]);

    if (input.client_uuid) {
      const previa = await c.query('SELECT id, folio, obra_id FROM requisiciones WHERE client_uuid = $1', [input.client_uuid]);
      if (previa.rows[0]) {
        if (previa.rows[0].obra_id !== obraId) throw new ConflictException('client_uuid usado en otra obra');
        return { id: previa.rows[0].id, folio: previa.rows[0].folio, duplicado: true };
      }
    }

    // folio consecutivo por obra, serializado para evitar huecos o choques
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`req:${obraId}`]);
    const { rows: [{ n }] } = await c.query<{ n: number }>(
      'SELECT count(*)::int + 1 AS n FROM requisiciones WHERE obra_id = $1', [obraId]);
    const folio = `REQ-${String(n).padStart(4, '0')}`;

    const { rows: [req] } = await c.query<{ id: string }>(
      `INSERT INTO requisiciones(empresa_id, obra_id, folio, solicitante_id, fecha_requerida, client_uuid)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [s.empresaId, obraId, folio, s.usuarioId, input.fecha_requerida ?? null, input.client_uuid ?? null],
    );

    for (const l of input.lineas) {
      const lc = await lineaDeControl(c, l.linea_control_id);
      if (lc.obra_id !== obraId) {
        throw new UnprocessableEntityException('La línea de control no pertenece a la obra de la requisición');
      }
      await c.query(
        `INSERT INTO requisicion_lineas(requisicion_id, obra_id, concepto_id, linea_control_id,
                                        cantidad, precio_estimado, justificacion)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [req.id, obraId, lc.concepto_id, l.linea_control_id, l.cantidad, l.precio_estimado, l.justificacion ?? null],
      );
    }
    return { id: req.id, folio, duplicado: false };
  }

  detalle(s: Tenant, id: string) {
    return this.db.tenant(s, async (c) => {
      const req = await cargar(c, id);
      await exigirRol(c, s.usuarioId, req.obra_id, [...CAPTURAN, 'COMPRAS', 'FINANZAS']);
      return conLineas(c, req);
    });
  }

  listar(s: Tenant, obraId: string) {
    return this.db.tenant(s, async (c) => {
      await exigirRol(c, s.usuarioId, obraId, [...CAPTURAN, 'COMPRAS', 'FINANZAS']);
      const { rows } = await c.query(
        `SELECT r.id, r.folio, r.estado, r.creado_en, r.fecha_requerida, u.nombre AS solicitante,
                count(l.id)::int AS lineas,
                COALESCE(sum(l.cantidad * l.precio_estimado), 0) AS importe_estimado,
                (array_agg(l.semaforo ORDER BY CASE l.semaforo WHEN 'ROJO' THEN 0 WHEN 'AMARILLO' THEN 1 ELSE 2 END))[1]
                  AS peor_semaforo
           FROM requisiciones r
           JOIN usuarios u ON u.id = r.solicitante_id
           LEFT JOIN requisicion_lineas l ON l.requisicion_id = r.id
          WHERE r.obra_id = $1
          GROUP BY r.id, u.nombre ORDER BY r.creado_en DESC`,
        [obraId],
      );
      return rows;
    });
  }

  /** BORRADOR → ENVIADA. El trigger calcula y guarda el semáforo de cada línea. */
  enviar(s: Tenant, id: string) {
    return this.transicion(s, id, ['BORRADOR'], 'ENVIADA', ['RESIDENTE', 'GERENTE_OBRA']);
  }

  /** ENVIADA → BORRADOR (corrección o tras una orden de cambio). */
  devolver(s: Tenant, id: string) {
    return this.transicion(s, id, ['ENVIADA'], 'BORRADOR', [...APRUEBAN]);
  }

  /** ENVIADA → APROBADA. El trigger re-valida con bloqueo y crea la reserva. */
  aprobar(s: Tenant, id: string) {
    return this.transicion(s, id, ['ENVIADA'], 'APROBADA', [...APRUEBAN], true);
  }

  /** Justifica y autoriza una línea en AMARILLO (gerente o director). */
  autorizarExcepcion(s: Tenant, id: string, lineaId: string, justificacion: string) {
    return this.db.tenant(s, async (c) => {
      const req = await cargar(c, id);
      await exigirRol(c, s.usuarioId, req.obra_id, [...AUTORIZAN_EXCEPCION]);
      if (req.estado !== 'ENVIADA') throw new ConflictException('Sólo se autorizan excepciones de requisiciones enviadas');
      const { rows } = await c.query(
        `UPDATE requisicion_lineas SET justificacion = $3, autoriza_excepcion_por = $4
          WHERE id = $2 AND requisicion_id = $1 AND semaforo = 'AMARILLO' RETURNING id`,
        [id, lineaId, justificacion, s.usuarioId],
      );
      if (!rows[0]) throw new UnprocessableEntityException('La línea no existe o no está en AMARILLO (las ROJAS requieren orden de cambio)');
      return conLineas(c, req);
    });
  }

  private transicion(s: Tenant, id: string, desde: string[], hacia: string, roles: string[], marcaAprobador = false) {
    return this.db.tenant(s, async (c) => {
      const req = await cargar(c, id, true);
      await exigirRol(c, s.usuarioId, req.obra_id, roles as never);
      if (!desde.includes(req.estado)) {
        throw new ConflictException(`La requisición está ${req.estado}; se esperaba ${desde.join(' o ')}`);
      }
      await c.query(
        `UPDATE requisiciones SET estado = $2, aprobada_por = CASE WHEN $3 THEN $4::uuid ELSE aprobada_por END
          WHERE id = $1`,
        [id, hacia, marcaAprobador, s.usuarioId],
      );
      return conLineas(c, await cargar(c, id));
    });
  }
}

async function lineaDeControl(c: PoolClient, id: string) {
  const { rows } = await c.query<{ obra_id: string; concepto_id: string }>(
    'SELECT obra_id, concepto_id FROM lineas_control WHERE id = $1', [id]);
  if (!rows[0]) throw new NotFoundException('Línea de control no encontrada');
  return rows[0];
}

async function cargar(c: PoolClient, id: string, bloquear = false) {
  const { rows } = await c.query(
    `SELECT id, obra_id, folio, estado, solicitante_id, creado_en, aprobada_por, aprobada_en
       FROM requisiciones WHERE id = $1 ${bloquear ? 'FOR UPDATE' : ''}`, [id]);
  if (!rows[0]) throw new NotFoundException('Requisición no encontrada');
  return rows[0];
}

async function conLineas(c: PoolClient, req: Record<string, unknown>) {
  const { rows } = await c.query(
    `SELECT l.id, l.concepto_id, co.clave AS concepto_clave, l.linea_control_id, i.descripcion AS insumo,
            i.unidad, l.cantidad, l.precio_estimado, l.semaforo, l.validacion, l.justificacion,
            l.autoriza_excepcion_por
       FROM requisicion_lineas l
       JOIN conceptos co ON co.id = l.concepto_id
       JOIN lineas_control lc ON lc.id = l.linea_control_id
       JOIN insumos i ON i.id = lc.insumo_id
      WHERE l.requisicion_id = $1 ORDER BY co.clave, i.clave`, [req.id]);
  return { ...req, lineas: rows };
}
