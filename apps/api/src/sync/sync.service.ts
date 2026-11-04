import { HttpException, Injectable } from '@nestjs/common';
import { DatabaseError } from 'pg';
import type { ComandoSync, ResultadoComando, SnapshotObra } from '@obraclara/contracts';
import { DbService, Tenant } from '../db/db.service';
import { exigirRol } from '../common/roles';
import { traducir } from '../common/pg-errors.filter';
import { AvancesService } from '../avances/avances.service';
import { RequisicionesService } from '../requisiciones/requisiciones.service';
import { cargarPresupuesto, ocultarImportes, VEN_IMPORTES } from '../obras/obras.service';

@Injectable()
export class SyncService {
  constructor(
    private readonly db: DbService,
    private readonly avances: AvancesService,
    private readonly reqs: RequisicionesService,
  ) {}

  /**
   * Aplica los comandos de la bandeja de salida del móvil. Cada comando corre en
   * su propio SAVEPOINT: uno rechazado no tumba a los demás. Reenviar es seguro
   * (idempotencia por client_uuid).
   */
  push(s: Tenant, comandos: ComandoSync[]): Promise<ResultadoComando[]> {
    return this.db.tenant(s, async (c) => {
      const resultados: ResultadoComando[] = [];
      for (const cmd of comandos) {
        await c.query('SAVEPOINT cmd');
        try {
          const r = cmd.tipo === 'AVANCE_CREAR'
            ? await this.avances.crearEnTx(c, s, cmd.obra_id, cmd.payload, cmd.client_uuid)
            : await this.reqs.crearEnTx(c, s, cmd.obra_id, { ...cmd.payload, client_uuid: cmd.client_uuid });
          await c.query('RELEASE SAVEPOINT cmd');
          resultados.push({ client_uuid: cmd.client_uuid, estado: r.duplicado ? 'DUPLICADO' : 'ACEPTADO', id: r.id });
        } catch (err) {
          await c.query('ROLLBACK TO SAVEPOINT cmd');
          resultados.push({ client_uuid: cmd.client_uuid, estado: 'RECHAZADO', motivo: motivo(err) });
        }
      }
      return resultados;
    });
  }

  /** Réplica de lectura de una obra para trabajar sin señal (unos cuantos KB–MB). */
  pull(s: Tenant, obraId: string): Promise<SnapshotObra> {
    return this.db.tenant(s, async (c) => {
      const roles = await exigirRol(c, s.usuarioId, obraId, ['CABO', 'RESIDENTE', 'ALMACEN', 'GERENTE_OBRA']);
      const { rows: [obra] } = await c.query(
        `SELECT id, clave, nombre, lat, lng, radio_geocerca_m, tol_amarillo_pct, tol_rojo_pct, tol_precio_pct,
                tol_anticipo_pts FROM obras WHERE id = $1`, [obraId]);
      const conImportes = roles.some((r) => r === 'DIRECTOR' || (VEN_IMPORTES as readonly string[]).includes(r));
      const conceptos = await cargarPresupuesto(c, obraId);
      const { rows: contratos } = await c.query(
        `SELECT cl.id AS contrato_linea_id, cd.folio AS contrato_folio, p.razon_social AS contratista,
                cl.concepto_id, cl.cantidad_contratada
           FROM contrato_destajo_lineas cl JOIN contratos_destajo cd ON cd.id = cl.contrato_id
           JOIN proveedores p ON p.id = cd.contratista_id
          WHERE cl.obra_id = $1 AND cd.estado = 'VIGENTE'`, [obraId]);
      const { rows: mis } = await c.query(
        `SELECT client_uuid, 'AVANCE' AS tipo, id, estado::text, NULL AS folio FROM avances
          WHERE obra_id = $1 AND capturado_por = $2 AND client_uuid IS NOT NULL AND fecha > current_date - 30
         UNION ALL
         SELECT client_uuid, 'REQUISICION', id, estado::text, folio FROM requisiciones
          WHERE obra_id = $1 AND solicitante_id = $2 AND client_uuid IS NOT NULL AND creado_en > now() - interval '30 days'`,
        [obraId, s.usuarioId]);
      return {
        obra, roles,
        // el cabo trabaja con cantidades; los importes sólo viajan a quien puede verlos
        conceptos: conImportes ? conceptos : conceptos.map(ocultarImportes),
        contratos,
        mis_documentos: mis,
        generado_en: new Date().toISOString(),
      };
    });
  }
}

function motivo(err: unknown): string {
  if (err instanceof HttpException) return err.message;
  if (err instanceof DatabaseError) return traducir(err).mensaje;
  return 'Error interno';
}
