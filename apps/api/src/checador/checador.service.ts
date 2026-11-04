import {
  ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  siguientesChecada,
  type ChecadaInput, type ChecadaRegistrada, type CorreccionInput, type CrearCentroInput, type CrearPeriodoInput,
  type CrearTrabajadorInput, type KioscoChecadaInput, type LoteChecadasInput, type ModalidadChecada,
  type PeriodoResumen, type PeriodoTrabajador, type RespuestaPeriodoInput, type ResultadoComando, type ResumenGrupo,
  type TableroAsistencia, type TipoChecada,
} from '@obraclara/contracts';
import { DbService, Tenant } from '../db/db.service';
import { exigirRolEmpresa, rolesEmpresa } from '../common/roles';
import { motivo } from '../sync/sync.service';

/** Quién administra la asistencia de la empresa (DIRECTOR y ADMIN siempre pasan). */
const SUPERVISA = ['RH'] as const;
const INTENTOS_PIN = 5;
const BLOQUEO_PIN = '15 minutes';

interface NuevaChecada {
  trabajadorId: string;
  tipo: TipoChecada;
  medio: 'CELULAR' | 'KIOSCO' | 'SUPERVISOR';
  modalidad: ModalidadChecada | null;
  ocurrido_en?: string;
  centro_id?: string;
  lat?: number;
  lng?: number;
  precision_m?: number;
  nota?: string;
  client_uuid?: string;
}

@Injectable()
export class ChecadorService {
  constructor(private readonly db: DbService) {}

  // ------------------------------------------------------------- trabajador (celular)
  /** Estado del día del trabajador ligado al usuario: qué botón mostrar y su bitácora. */
  miDia(s: Tenant) {
    return this.db.tenant(s, async (c) => {
      const t = await this.trabajadorDeUsuario(c, s.usuarioId);
      const { rows: bitacora } = await c.query(
        `SELECT c.id, c.tipo, c.ocurrido_en, c.modalidad, c.incidencias, ct.nombre AS centro
           FROM v_checadas_vigentes c LEFT JOIN centros_trabajo ct ON ct.id = c.centro_id
          WHERE c.trabajador_id = $1 AND c.fecha = (SELECT (now() AT TIME ZONE zona_horaria)::date FROM empresas)
          ORDER BY c.ocurrido_en`, [t.id]);
      const ultimo = await this.ultimoTipo(c, t.id);
      return { trabajador: t, bitacora, siguientes: siguientesChecada(ultimo) };
    });
  }

  checar(s: Tenant, input: ChecadaInput): Promise<ChecadaRegistrada> {
    return this.db.tenant(s, async (c) => {
      const t = await this.trabajadorDeUsuario(c, s.usuarioId);
      return this.insertar(c, s, { ...input, trabajadorId: t.id, medio: 'CELULAR' });
    });
  }

  /** Checadas guardadas sin señal. Cada una en su SAVEPOINT; reenviar es seguro (client_uuid). */
  lote(s: Tenant, input: LoteChecadasInput): Promise<ResultadoComando[]> {
    return this.db.tenant(s, async (c) => {
      const t = await this.trabajadorDeUsuario(c, s.usuarioId);
      const resultados: ResultadoComando[] = [];
      // en orden cronológico, para que la secuencia entrada → salida se evalúe bien
      const ordenadas = [...input.checadas].sort((a, b) => Date.parse(a.ocurrido_en) - Date.parse(b.ocurrido_en));
      for (const ch of ordenadas) {
        await c.query('SAVEPOINT ch');
        try {
          const r = await this.insertar(c, s, { ...ch, trabajadorId: t.id, medio: 'CELULAR' });
          await c.query('RELEASE SAVEPOINT ch');
          resultados.push({ client_uuid: ch.client_uuid, estado: r.duplicado ? 'DUPLICADO' : 'ACEPTADO', id: r.id });
        } catch (err) {
          await c.query('ROLLBACK TO SAVEPOINT ch');
          resultados.push({ client_uuid: ch.client_uuid, estado: 'RECHAZADO', motivo: motivo(err) });
        }
      }
      return resultados;
    });
  }

  // ------------------------------------------------------------- kiosco compartido
  async kiosco(s: Tenant, input: KioscoChecadaInput): Promise<ChecadaRegistrada> {
    // el conteo de intentos fallidos debe persistir aunque la checada se rechace
    const r = await this.db.tenant(s, async (c) => {
      await exigirRolEmpresa(c, s.usuarioId, ['KIOSCO', ...SUPERVISA]);
      const { rows: [t] } = await c.query<{ id: string; pin_ok: boolean; bloqueado: boolean }>(
        `SELECT id, (pin_hash IS NOT NULL AND pin_hash = crypt($2, pin_hash)) AS pin_ok,
                COALESCE(bloqueado_hasta > now(), false) AS bloqueado
           FROM trabajadores WHERE numero = $1 AND activo FOR UPDATE`, [input.numero, input.pin]);
      if (!t) return { error: 'Número o PIN incorrecto' } as const;
      if (t.bloqueado) return { error: 'Demasiados intentos; espere unos minutos o avise a RH' } as const;
      if (!t.pin_ok) {
        await c.query(
          `UPDATE trabajadores SET intentos_pin = intentos_pin + 1,
                  bloqueado_hasta = CASE WHEN intentos_pin + 1 >= $2 THEN now() + $3::interval END
            WHERE id = $1`, [t.id, INTENTOS_PIN, BLOQUEO_PIN]);
        return { error: 'Número o PIN incorrecto' } as const;
      }
      await c.query('UPDATE trabajadores SET intentos_pin = 0, bloqueado_hasta = NULL WHERE id = $1', [t.id]);
      const tipo = input.tipo ?? siguientesChecada(await this.ultimoTipo(c, t.id, input.ocurrido_en))[0];
      return {
        checada: await this.insertar(c, s, {
          trabajadorId: t.id, tipo, medio: 'KIOSCO', modalidad: 'KIOSCO', centro_id: input.centro_id,
          ocurrido_en: input.ocurrido_en, client_uuid: input.client_uuid,
        }),
      } as const;
    });
    if ('error' in r) throw new UnauthorizedException(r.error);
    return r.checada;
  }

  // ------------------------------------------------------------- supervisión (RH)
  corregir(s: Tenant, input: CorreccionInput): Promise<ChecadaRegistrada> {
    return this.db.tenant(s, async (c) => {
      await exigirRolEmpresa(c, s.usuarioId, [...SUPERVISA]);
      return this.insertar(c, s, {
        trabajadorId: input.trabajador_id, tipo: input.tipo, medio: 'SUPERVISOR', modalidad: null,
        ocurrido_en: input.ocurrido_en, nota: input.motivo,
      });
    });
  }

  anular(s: Tenant, checadaId: string, motivoAnulacion: string) {
    return this.db.tenant(s, async (c) => {
      await exigirRolEmpresa(c, s.usuarioId, [...SUPERVISA]);
      const { rowCount } = await c.query(
        `INSERT INTO checadas_anuladas(checada_id, empresa_id, motivo, anulada_por)
         SELECT id, empresa_id, $2, $3 FROM checadas WHERE id = $1
         ON CONFLICT (checada_id) DO NOTHING`, [checadaId, motivoAnulacion, s.usuarioId]);
      if (!rowCount) {
        const { rows } = await c.query('SELECT 1 FROM checadas WHERE id = $1', [checadaId]);
        if (!rows[0]) throw new NotFoundException('Checada no encontrada');
        throw new ConflictException('La checada ya estaba anulada');
      }
      return { id: checadaId, anulada: true };
    });
  }

  tablero(s: Tenant, fecha?: string): Promise<TableroAsistencia> {
    return this.db.tenant(s, async (c) => {
      await exigirRolEmpresa(c, s.usuarioId, [...SUPERVISA, 'GERENTE_OBRA']);
      return this.armarTablero(c, fecha);
    });
  }

  /**
   * Vista del dueño del grupo: recorre cada empresa en la que la persona tiene
   * usuario y, con la sesión de ESA empresa (RLS incluido), toma el resumen del día.
   */
  async grupo(s: Tenant): Promise<ResumenGrupo> {
    const accesos = await this.db.sistema(async (c) => (await c.query<{ usuario_id: string; empresa_id: string }>(
      `SELECT u.id AS usuario_id, u.empresa_id
         FROM oc.usuarios yo
         JOIN oc.usuarios u ON lower(u.email) = lower(yo.email) AND u.activo
         JOIN oc.empresas e ON e.id = u.empresa_id
        WHERE yo.id = $1 AND yo.empresa_id = $2 AND yo.activo
        ORDER BY e.clave NULLS LAST, e.nombre`, [s.usuarioId, s.empresaId])).rows);
    const empresas: ResumenGrupo['empresas'] = [];
    for (const a of accesos) {
      const fila = await this.db.tenant({ usuarioId: a.usuario_id, empresaId: a.empresa_id }, async (c) => {
        const roles = await rolesEmpresa(c, a.usuario_id);
        if (!roles.some((r) => r === 'DIRECTOR' || r === 'ADMIN' || r === 'RH')) return null;
        const t = await this.armarTablero(c);
        return { ...t.empresa, ...t.resumen };
      });
      if (fila) empresas.push(fila);
    }
    return { empresas };
  }

  // ------------------------------------------------------------- catálogos
  trabajadores(s: Tenant) {
    return this.db.tenant(s, async (c) => {
      await exigirRolEmpresa(c, s.usuarioId, [...SUPERVISA]);
      const { rows } = await c.query(
        `SELECT t.id, t.numero, t.nombre, t.modalidades::text[] AS modalidades, t.jornada_min, t.activo, ct.nombre AS centro,
                u.email AS usuario_email, t.pin_hash IS NOT NULL AS tiene_pin
           FROM trabajadores t LEFT JOIN centros_trabajo ct ON ct.id = t.centro_id
           LEFT JOIN usuarios u ON u.id = t.usuario_id
          ORDER BY t.numero`);
      return rows;
    });
  }

  crearTrabajador(s: Tenant, input: CrearTrabajadorInput) {
    return this.db.tenant(s, async (c) => {
      await exigirRolEmpresa(c, s.usuarioId, [...SUPERVISA]);
      let usuarioId: string | null = null;
      if (input.usuario_email) {
        // RLS: sólo encuentra usuarios de la empresa de la sesión
        const { rows: [u] } = await c.query('SELECT id FROM usuarios WHERE lower(email) = lower($1)', [input.usuario_email]);
        if (!u) throw new UnprocessableEntityException('Ese correo no es usuario de esta empresa');
        usuarioId = u.id;
      }
      if (input.modalidades.includes('KIOSCO') && !input.pin) {
        throw new UnprocessableEntityException('Para checar en kiosco el trabajador necesita PIN');
      }
      const { rows: [t] } = await c.query<{ id: string }>(
        `INSERT INTO trabajadores(empresa_id, numero, nombre, usuario_id, centro_id, modalidades, jornada_min, pin_hash)
         VALUES ($1, $2, $3, $4, $5, $6::modalidad_checada[], $7, CASE WHEN $8::text IS NULL THEN NULL ELSE crypt($8, gen_salt('bf', 8)) END)
         RETURNING id`,
        [s.empresaId, input.numero, input.nombre, usuarioId, input.centro_id ?? null, input.modalidades,
         input.jornada_min, input.pin ?? null]);
      return t;
    });
  }

  centros(s: Tenant) {
    return this.db.tenant(s, async (c) => {
      await exigirRolEmpresa(c, s.usuarioId, [...SUPERVISA, 'KIOSCO', 'GERENTE_OBRA']);
      const { rows } = await c.query(
        'SELECT id, clave, nombre, obra_id, lat, lng, radio_m FROM centros_trabajo WHERE activo ORDER BY clave');
      return rows;
    });
  }

  crearCentro(s: Tenant, input: CrearCentroInput) {
    return this.db.tenant(s, async (c) => {
      await exigirRolEmpresa(c, s.usuarioId, [...SUPERVISA]);
      const { rows: [ct] } = await c.query<{ id: string }>(
        `INSERT INTO centros_trabajo(empresa_id, clave, nombre, obra_id, lat, lng, radio_m)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [s.empresaId, input.clave, input.nombre, input.obra_id ?? null, input.lat ?? null, input.lng ?? null, input.radio_m]);
      return ct;
    });
  }

  // ------------------------------------------------------------- periodos
  periodos(s: Tenant): Promise<PeriodoResumen[]> {
    return this.db.tenant(s, async (c) => {
      await exigirRolEmpresa(c, s.usuarioId, [...SUPERVISA]);
      const { rows } = await c.query<PeriodoResumen>(
        `SELECT p.id, p.nombre, p.inicio::text, p.fin::text, p.estado,
                count(pt.*)::int AS trabajadores,
                count(*) FILTER (WHERE pt.respuesta = 'ACEPTADO')::int AS aceptados,
                count(*) FILTER (WHERE pt.respuesta = 'OBJETADO')::int AS objetados
           FROM periodos_asistencia p LEFT JOIN periodo_trabajadores pt ON pt.periodo_id = p.id
          GROUP BY p.id ORDER BY p.inicio DESC`);
      return rows;
    });
  }

  crearPeriodo(s: Tenant, input: CrearPeriodoInput) {
    return this.db.tenant(s, async (c) => {
      await exigirRolEmpresa(c, s.usuarioId, [...SUPERVISA]);
      const { rows: [p] } = await c.query<{ id: string }>(
        'INSERT INTO periodos_asistencia(empresa_id, nombre, inicio, fin) VALUES ($1, $2, $3, $4) RETURNING id',
        [s.empresaId, input.nombre, input.inicio, input.fin]);
      return p;
    });
  }

  cerrarPeriodo(s: Tenant, id: string) {
    return this.db.tenant(s, async (c) => {
      await exigirRolEmpresa(c, s.usuarioId, [...SUPERVISA]);
      const { rows: [r] } = await c.query<{ n: number }>('SELECT cerrar_periodo($1) AS n', [id]);
      return { id, trabajadores: r.n };
    });
  }

  detallePeriodo(s: Tenant, id: string): Promise<PeriodoTrabajador[]> {
    return this.db.tenant(s, async (c) => {
      await exigirRolEmpresa(c, s.usuarioId, [...SUPERVISA]);
      const { rows } = await c.query<PeriodoTrabajador>(
        `SELECT t.id AS trabajador_id, t.numero, t.nombre, round(pt.minutos_trabajados / 60.0, 2)::float8 AS horas,
                pt.dias_trabajados, pt.incidencias, pt.correcciones, pt.jornadas_abiertas, pt.respuesta, pt.comentario
           FROM periodo_trabajadores pt JOIN trabajadores t ON t.id = pt.trabajador_id
          WHERE pt.periodo_id = $1 ORDER BY t.numero`, [id]);
      return rows;
    });
  }

  /** Periodos cerrados del trabajador de la sesión, para que los acepte u objete. */
  misPeriodos(s: Tenant) {
    return this.db.tenant(s, async (c) => {
      const t = await this.trabajadorDeUsuario(c, s.usuarioId);
      const { rows } = await c.query(
        `SELECT p.id, p.nombre, p.inicio::text, p.fin::text, round(pt.minutos_trabajados / 60.0, 2)::float8 AS horas,
                pt.dias_trabajados, pt.incidencias, pt.correcciones, pt.jornadas_abiertas, pt.respuesta, pt.comentario
           FROM periodo_trabajadores pt JOIN periodos_asistencia p ON p.id = pt.periodo_id
          WHERE pt.trabajador_id = $1 ORDER BY p.inicio DESC`, [t.id]);
      return rows;
    });
  }

  responderPeriodo(s: Tenant, periodoId: string, input: RespuestaPeriodoInput) {
    return this.db.tenant(s, async (c) => {
      const t = await this.trabajadorDeUsuario(c, s.usuarioId);
      const { rowCount } = await c.query(
        `UPDATE periodo_trabajadores SET respuesta = $3, comentario = $4, respondido_en = now()
          WHERE periodo_id = $1 AND trabajador_id = $2`,
        [periodoId, t.id, input.acepta ? 'ACEPTADO' : 'OBJETADO', input.comentario ?? null]);
      if (!rowCount) throw new NotFoundException('No hay un periodo cerrado con su asistencia');
      return { periodo_id: periodoId, respuesta: input.acepta ? 'ACEPTADO' : 'OBJETADO' };
    });
  }

  // ------------------------------------------------------------- internos
  private async trabajadorDeUsuario(c: PoolClient, usuarioId: string) {
    const { rows: [t] } = await c.query<{ id: string; numero: string; nombre: string; modalidades: string[];
                                          centro_id: string | null }>(
      'SELECT id, numero, nombre, modalidades::text[] AS modalidades, centro_id FROM trabajadores WHERE usuario_id = $1 AND activo',
      [usuarioId]);
    if (!t) throw new ForbiddenException('Su usuario no está registrado como trabajador en esta empresa');
    return t;
  }

  /** Última checada vigente (antes de `antes`, o ahora); null si no hay o si pasaron más de 16 h. */
  private async ultimoTipo(c: PoolClient, trabajadorId: string, antes?: string): Promise<TipoChecada | null> {
    const { rows: [u] } = await c.query<{ tipo: TipoChecada }>(
      `SELECT tipo FROM v_checadas_vigentes
        WHERE trabajador_id = $1 AND ocurrido_en <= COALESCE($2::timestamptz, now())
          AND ocurrido_en > COALESCE($2::timestamptz, now()) - interval '16 hours'
        ORDER BY ocurrido_en DESC LIMIT 1`, [trabajadorId, antes ?? null]);
    return u?.tipo ?? null;
  }

  private async insertar(c: PoolClient, s: Tenant, n: NuevaChecada): Promise<ChecadaRegistrada> {
    if (n.client_uuid) {
      const { rows: [dup] } = await c.query(
        `SELECT c.id, c.trabajador_id, t.nombre AS trabajador, c.tipo, c.ocurrido_en, c.incidencias
           FROM checadas c JOIN trabajadores t ON t.id = c.trabajador_id WHERE c.client_uuid = $1`, [n.client_uuid]);
      if (dup) {
        if (dup.trabajador_id !== n.trabajadorId) throw new ConflictException('client_uuid usado por otro trabajador');
        const { trabajador_id: _, ...resto } = dup;
        return { ...resto, duplicado: true };
      }
    }
    const { rows: [ch] } = await c.query(
      `WITH ins AS (
         INSERT INTO checadas(empresa_id, trabajador_id, tipo, medio, modalidad, ocurrido_en, centro_id,
                              lat, lng, precision_m, nota, client_uuid, registrado_por)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), $7, $8, $9, $10, $11, $12, $13)
         RETURNING id, trabajador_id, tipo, ocurrido_en, incidencias)
       SELECT ins.id, t.nombre AS trabajador, ins.tipo, ins.ocurrido_en, ins.incidencias
         FROM ins JOIN trabajadores t ON t.id = ins.trabajador_id`,
      [s.empresaId, n.trabajadorId, n.tipo, n.medio, n.modalidad, n.ocurrido_en ?? null, n.centro_id ?? null,
       n.lat ?? null, n.lng ?? null, n.precision_m ?? null, n.nota ?? null, n.client_uuid ?? null, s.usuarioId]);
    return { ...ch, duplicado: false };
  }

  private async armarTablero(c: PoolClient, fecha?: string): Promise<TableroAsistencia> {
    const { rows: [e] } = await c.query<{ id: string; clave: string | null; nombre: string; fecha: string }>(
      `SELECT id, clave, nombre, COALESCE($1::date, (now() AT TIME ZONE zona_horaria)::date)::text AS fecha
         FROM empresas`, [fecha ?? null]);
    const { rows: trabajadores } = await c.query(
      `SELECT t.id AS trabajador_id, t.numero, t.nombre, ct.nombre AS centro,
              CASE u.tipo WHEN 'ENTRADA' THEN 'TRABAJANDO' WHEN 'FIN_DESCANSO' THEN 'TRABAJANDO'
                          WHEN 'INICIO_DESCANSO' THEN 'EN_DESCANSO' WHEN 'SALIDA' THEN 'SALIO'
                          ELSE 'SIN_REGISTRO' END AS estado,
              u.ocurrido_en AS ultima_checada, u.modalidad,
              COALESCE((SELECT array_agg(DISTINCT i ORDER BY i) FROM v_checadas_vigentes x, unnest(x.incidencias) i
                         WHERE x.trabajador_id = t.id AND x.fecha = $1::date), '{}') AS incidencias
         FROM trabajadores t
         LEFT JOIN LATERAL (SELECT c.tipo, c.ocurrido_en, c.modalidad, c.centro_id FROM v_checadas_vigentes c
                             WHERE c.trabajador_id = t.id AND c.fecha = $1::date
                             ORDER BY c.ocurrido_en DESC LIMIT 1) u ON true
         LEFT JOIN centros_trabajo ct ON ct.id = COALESCE(u.centro_id, t.centro_id)
        WHERE t.activo
        ORDER BY t.numero`, [e.fecha]);
    const { rows: incidencias } = await c.query(
      `SELECT c.id AS checada_id, t.nombre AS trabajador, c.tipo, c.ocurrido_en, c.incidencias, c.distancia_m
         FROM v_checadas_vigentes c JOIN trabajadores t ON t.id = c.trabajador_id
        WHERE c.fecha = $1::date AND cardinality(c.incidencias) > 0
        ORDER BY c.ocurrido_en DESC`, [e.fecha]);
    const cuenta = (estado: string) => trabajadores.filter((t) => t.estado === estado).length;
    return {
      empresa: { id: e.id, clave: e.clave, nombre: e.nombre },
      fecha: e.fecha,
      resumen: {
        trabajando: cuenta('TRABAJANDO'),
        en_descanso: cuenta('EN_DESCANSO'),
        salieron: cuenta('SALIO'),
        sin_registro: cuenta('SIN_REGISTRO'),
        requieren_atencion: trabajadores.filter((t) => t.incidencias.length > 0).length,
      },
      trabajadores,
      incidencias,
    };
  }
}
