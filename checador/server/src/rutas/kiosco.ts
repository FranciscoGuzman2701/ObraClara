import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.js';
import { HttpError, noEncontrado } from '../errores.js';
import * as E from '../esquemas.js';
import { sha256 } from '../sesion.js';
import { insertarChecada, siguientes } from '../servicios.js';

const INTENTOS_PIN = 5;
const BLOQUEO = '15 minutes';

export function rutasKiosco(app: FastifyInstance, { sesiones }: Deps) {
  /** RH activa la tableta en un centro; el token sólo se muestra esta vez y vive en la tableta. */
  app.post('/api/kiosco/activar', async (req, reply) => {
    const b = E.ActivarKiosco.parse(req.body);
    const token = randomBytes(24).toString('base64url');
    const r = await sesiones.conMiembro(req, 'gestionar', async (c, m) => {
      const { rows: [ct] } = await c.query('SELECT nombre FROM centros WHERE id = $1 AND activo', [b.centro_id]);
      if (!ct) throw noEncontrado('Centro no encontrado');
      const { rows: [d] } = await c.query<{ id: string }>(
        `INSERT INTO dispositivos(empresa_id, centro_id, nombre, token_hash, creado_por)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`, [m.empresaId, b.centro_id, b.nombre, sha256(token), m.cuentaId]);
      return { id: d.id, centro: ct.nombre };
    });
    return reply.status(201).send({ ...r, token });
  });

  app.get('/api/kiosco', (req) => sesiones.conKiosco(req, async (_c, k) => ({
    empresa: k.empresa, clave: k.clave, centro: k.centro,
  })));

  /** Número + PIN. Si no se indica el tipo, se deduce (entrada → descanso/salida…). */
  app.post('/api/kiosco/checar', async (req, reply) => {
    const b = E.Kiosco.parse(req.body);
    // los intentos fallidos se guardan aunque la checada se rechace: el error se lanza después del COMMIT
    const r = await sesiones.conKiosco(req, async (c, k) => {
      const { rows: [t] } = await c.query<{ id: string; pin_ok: boolean; bloqueado: boolean; kiosco: boolean }>(
        `SELECT id, (pin_hash IS NOT NULL AND pin_hash = crypt($2, pin_hash)) AS pin_ok,
                COALESCE(bloqueado_hasta > now(), false) AS bloqueado, 'KIOSCO' = ANY (modalidades) AS kiosco
           FROM trabajadores WHERE numero = $1 AND activo FOR UPDATE`, [b.numero, b.pin]);
      if (!t) return { error: 'Número o PIN incorrecto' };
      if (t.bloqueado) return { error: 'Demasiados intentos con PIN incorrecto. Espere 15 minutos o avise a RH.' };
      if (!t.pin_ok) {
        await c.query(
          `UPDATE trabajadores SET intentos_pin = intentos_pin + 1,
                  bloqueado_hasta = CASE WHEN intentos_pin + 1 >= $2 THEN now() + $3::interval END
            WHERE id = $1`, [t.id, INTENTOS_PIN, BLOQUEO]);
        return { error: 'Número o PIN incorrecto' };
      }
      await c.query('UPDATE trabajadores SET intentos_pin = 0, bloqueado_hasta = NULL WHERE id = $1', [t.id]);
      if (!t.kiosco) return { error: 'Usted no tiene habilitado checar en kiosco; use su celular' };
      const tipo = b.tipo ?? (await siguientes(c, t.id))[0];
      const ch = await insertarChecada(c, k.empresaId, {
        trabajadorId: t.id, tipo, medio: 'KIOSCO', modalidad: 'KIOSCO', centro_id: k.centroId,
        client_uuid: b.client_uuid, cuentaId: null, dispositivoId: k.dispositivoId, foto: b.foto,
      });
      return { checada: { ...ch, siguientes: await siguientes(c, t.id) } };
    });
    if ('error' in r) throw new HttpError(401, r.error as string);
    return reply.status(201).send(r.checada);
  });
}
