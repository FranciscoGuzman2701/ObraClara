import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.js';
import { HttpError, noEncontrado } from '../errores.js';
import * as E from '../esquemas.js';
import { armarTablero, bitacora, fechaLocal, insertarChecada } from '../servicios.js';
import type { ResumenEmpresa } from '../tipos.js';

export function rutasEquipo(app: FastifyInstance, { db, sesiones }: Deps) {
  app.get('/api/equipo/tablero', (req) => {
    const { fecha } = E.FechaQuery.parse(req.query);
    return sesiones.conMiembro(req, 'verEquipo', (c) => armarTablero(c, fecha));
  });

  app.get('/api/equipo/bitacora', (req) => {
    const q = E.BitacoraQuery.parse(req.query);
    return sesiones.conMiembro(req, 'verEquipo', async (c) =>
      bitacora(c, { fecha: q.fecha ?? (await fechaLocal(c)), trabajadorId: q.trabajador_id }));
  });

  /** RH captura una checada que faltó (olvido, celular sin batería…). Siempre con motivo. */
  app.post('/api/equipo/correcciones', async (req, reply) => {
    const b = E.Correccion.parse(req.body);
    const r = await sesiones.conMiembro(req, 'gestionar', (c, m) => insertarChecada(c, m.empresaId, {
      trabajadorId: b.trabajador_id, tipo: b.tipo, medio: 'SUPERVISOR', modalidad: null, ocurrido_en: b.ocurrido_en,
      nota: b.motivo, cuentaId: m.cuentaId,
    }));
    return reply.status(201).send(r);
  });

  /** Anular no borra: la checada queda en el libro con quién, cuándo y por qué se anuló. */
  app.post<{ Params: { id: string } }>('/api/equipo/checadas/:id/anular', (req) => {
    const { motivo } = E.Anular.parse(req.body);
    return sesiones.conMiembro(req, 'gestionar', async (c, m) => {
      const { rowCount } = await c.query(
        `INSERT INTO checadas_anuladas(checada_id, empresa_id, motivo, anulada_por)
         SELECT id, empresa_id, $2, $3 FROM checadas WHERE id = $1 ON CONFLICT (checada_id) DO NOTHING`,
        [req.params.id, motivo, m.cuentaId]);
      if (!rowCount) {
        const { rows } = await c.query('SELECT 1 FROM checadas WHERE id = $1', [req.params.id]);
        if (!rows[0]) throw noEncontrado('Checada no encontrada');
        throw new HttpError(409, 'La checada ya estaba anulada');
      }
      return { ok: true };
    });
  });

  /**
   * Vista del grupo: una fila por empresa a la que la cuenta tiene acceso como
   * supervisor o más. Cada empresa se consulta con su propia sesión (RLS incluido).
   */
  app.get('/api/grupo', async (req) => {
    const s = await sesiones.leer(req);
    const accesos = await db.sistema(async (c) => (await c.query<{ empresa_id: string; rol: ResumenEmpresa['rol'] }>(
      `SELECT m.empresa_id, m.rol FROM membresias m JOIN empresas e ON e.id = m.empresa_id
        WHERE m.cuenta_id = $1 AND m.activa AND m.rol <> 'TRABAJADOR' ORDER BY e.clave`, [s.cuentaId])).rows);
    const empresas: ResumenEmpresa[] = [];
    for (const a of accesos) {
      const t = await db.empresa({ empresaId: a.empresa_id, cuentaId: s.cuentaId }, (c) => armarTablero(c));
      empresas.push({ ...t.empresa, ...t.resumen, rol: a.rol });
    }
    return { empresas };
  });
}
