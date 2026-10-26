import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ConfirmarArchivoInput, PrefirmarInput } from '@obraclara/contracts';
import { DbService, Tenant } from '../db/db.service';
import { exigirRol } from '../common/roles';
import { Storage } from './storage.service';

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic',
  'application/pdf': 'pdf', 'application/xml': 'xml', 'text/xml': 'xml',
};

// Tabla y columna de obra para verificar que la entidad pertenece a la obra del archivo
const ENTIDADES: Record<ConfirmarArchivoInput['entidad_tipo'], string> = {
  AVANCE: 'avances', RECEPCION: 'recepciones', REQUISICION: 'requisiciones', MOV_ALMACEN: 'movimientos_almacen',
  ESTIMACION: 'estimaciones_destajo', COTIZACION: 'cotizaciones', FACTURA: '', PAGO: '',
};

@Injectable()
export class ArchivosService {
  constructor(private readonly db: DbService, private readonly storage: Storage) {}

  prefirmar(s: Tenant, input: PrefirmarInput) {
    return this.db.tenant(s, async (c) => {
      await exigirRol(c, s.usuarioId, input.obra_id, ['CABO', 'RESIDENTE', 'ALMACEN', 'GERENTE_OBRA', 'COMPRAS', 'FINANZAS']);
      const id = randomUUID();
      const hoy = new Date();
      const key = `${s.empresaId}/${input.obra_id}/${hoy.getUTCFullYear()}/${String(hoy.getUTCMonth() + 1).padStart(2, '0')}/${id}.${EXT[input.mime]}`;
      const { rows: [dup] } = await c.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM archivos WHERE empresa_id = $1 AND sha256 = $2', [s.empresaId, input.sha256]);
      await c.query(
        `INSERT INTO archivos(id, empresa_id, storage_key, mime, bytes, sha256, subido_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, s.empresaId, key, input.mime, input.bytes, input.sha256, s.usuarioId]);
      return {
        archivo_id: id,
        upload_url: await this.storage.urlDeSubida(key, input.mime, input.bytes),
        headers: { 'Content-Type': input.mime },
        // misma foto ya subida antes: se permite, pero la validación de avances la rechazará
        posible_duplicado: dup.n > 0,
      };
    });
  }

  confirmar(s: Tenant, input: ConfirmarArchivoInput) {
    return this.db.tenant(s, async (c) => {
      const { rows: [archivo] } = await c.query('SELECT id, storage_key FROM archivos WHERE id = $1', [input.archivo_id]);
      if (!archivo) throw new NotFoundException('Archivo no encontrado');
      const tabla = ENTIDADES[input.entidad_tipo];
      if (tabla) {
        const { rows: [ent] } = await c.query(`SELECT obra_id FROM ${tabla} WHERE id = $1`, [input.entidad_id]);
        if (!ent) throw new NotFoundException(`${input.entidad_tipo} no encontrado`);
        await exigirRol(c, s.usuarioId, ent.obra_id, ['CABO', 'RESIDENTE', 'ALMACEN', 'GERENTE_OBRA', 'COMPRAS', 'FINANZAS']);
      }
      if (!(await this.storage.existe(archivo.storage_key))) {
        throw new UnprocessableEntityException('El archivo aún no se ha subido al almacenamiento');
      }
      await c.query(
        `UPDATE archivos SET tomada_en = COALESCE($2, tomada_en), lat = COALESCE($3, lat), lng = COALESCE($4, lng)
          WHERE id = $1`,
        [input.archivo_id, input.tomada_en ?? null, input.lat ?? null, input.lng ?? null]);
      await c.query(
        `INSERT INTO evidencias(archivo_id, entidad_tipo, entidad_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [input.archivo_id, input.entidad_tipo, input.entidad_id]);
      return { ok: true };
    });
  }
}
