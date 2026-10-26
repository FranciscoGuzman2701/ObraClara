import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { CrearAvanceInput } from '@obraclara/contracts';
import { DbService, Tenant } from '../db/db.service';
import { exigirRol } from '../common/roles';

@Injectable()
export class AvancesService {
  constructor(private readonly db: DbService) {}

  crear(s: Tenant, obraId: string, input: CrearAvanceInput, clientUuid?: string) {
    return this.db.tenant(s, (c) => this.crearEnTx(c, s, obraId, input, clientUuid));
  }

  async crearEnTx(c: PoolClient, s: Tenant, obraId: string, input: CrearAvanceInput, clientUuid?: string) {
    await exigirRol(c, s.usuarioId, obraId, ['CABO', 'RESIDENTE', 'GERENTE_OBRA']);
    if (clientUuid) {
      const { rows } = await c.query('SELECT id, obra_id FROM avances WHERE client_uuid = $1', [clientUuid]);
      if (rows[0]) {
        if (rows[0].obra_id !== obraId) throw new ConflictException('client_uuid usado en otra obra');
        return { id: rows[0].id as string, duplicado: true };
      }
    }
    if (input.contrato_linea_id) {
      const { rows } = await c.query(
        `SELECT cl.concepto_id, cd.estado FROM contrato_destajo_lineas cl
           JOIN contratos_destajo cd ON cd.id = cl.contrato_id
          WHERE cl.id = $1 AND cl.obra_id = $2`, [input.contrato_linea_id, obraId]);
      if (!rows[0]) throw new UnprocessableEntityException('Línea de contrato no encontrada en la obra');
      if (rows[0].concepto_id !== input.concepto_id) {
        throw new UnprocessableEntityException('La línea de contrato corresponde a otro concepto');
      }
      if (rows[0].estado !== 'VIGENTE') throw new UnprocessableEntityException('El contrato de destajo no está vigente');
    }
    const { rows: [a] } = await c.query<{ id: string }>(
      `INSERT INTO avances(obra_id, concepto_id, contrato_linea_id, cantidad, fecha, ubicacion_texto, lat, lng,
                           capturado_por, client_uuid)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [obraId, input.concepto_id, input.contrato_linea_id ?? null, input.cantidad, input.fecha,
       input.ubicacion_texto ?? null, input.lat ?? null, input.lng ?? null, s.usuarioId, clientUuid ?? null],
    );
    return { id: a.id, duplicado: false };
  }

  listar(s: Tenant, obraId: string, estado?: string) {
    return this.db.tenant(s, async (c) => {
      await exigirRol(c, s.usuarioId, obraId, ['CABO', 'RESIDENTE', 'GERENTE_OBRA', 'FINANZAS']);
      const { rows } = await c.query(
        `SELECT a.id, a.fecha, a.cantidad, a.estado, a.ubicacion_texto, co.clave AS concepto_clave,
                co.descripcion AS concepto, co.unidad, u.nombre AS capturado_por,
                (SELECT count(*)::int FROM evidencias e WHERE e.entidad_tipo = 'AVANCE' AND e.entidad_id = a.id) AS fotos
           FROM avances a JOIN conceptos co ON co.id = a.concepto_id JOIN usuarios u ON u.id = a.capturado_por
          WHERE a.obra_id = $1 AND ($2::text IS NULL OR a.estado::text = $2)
          ORDER BY a.fecha DESC, co.clave`, [obraId, estado ?? null]);
      return rows;
    });
  }

  /** El trigger exige foto, segregación de funciones, hash no reciclado y ≤ 100 % del concepto. */
  validar(s: Tenant, id: string) {
    return this.cambiarEstado(s, id, 'VALIDADO');
  }

  rechazar(s: Tenant, id: string, motivo: string) {
    return this.cambiarEstado(s, id, 'RECHAZADO', motivo);
  }

  private cambiarEstado(s: Tenant, id: string, estado: 'VALIDADO' | 'RECHAZADO', motivo?: string) {
    return this.db.tenant(s, async (c) => {
      const { rows } = await c.query('SELECT obra_id, estado FROM avances WHERE id = $1 FOR UPDATE', [id]);
      if (!rows[0]) throw new NotFoundException('Avance no encontrado');
      await exigirRol(c, s.usuarioId, rows[0].obra_id, ['RESIDENTE', 'GERENTE_OBRA']);
      if (rows[0].estado !== 'CAPTURADO') throw new ConflictException(`El avance ya está ${rows[0].estado}`);
      const { rows: [a] } = await c.query(
        `UPDATE avances SET estado = $2, validado_por = $3, motivo_rechazo = $4 WHERE id = $1
         RETURNING id, estado, validado_por, validado_en, motivo_rechazo`,
        [id, estado, s.usuarioId, motivo ?? null]);
      return a;
    });
  }
}
