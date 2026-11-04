import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.js';
import type { Cliente } from '../db.js';
import { motivoDe, noEncontrado, prohibido } from '../errores.js';
import * as E from '../esquemas.js';
import type { Miembro } from '../sesion.js';
import { bitacora, fechaLocal, insertarChecada, siguientes } from '../servicios.js';
import type { MiDia, MiPeriodo, ResultadoLote } from '../tipos.js';

function trabajadorDe(m: Miembro): string {
  if (!m.trabajadorId) throw prohibido('Su cuenta no está ligada a una ficha de trabajador');
  return m.trabajadorId;
}

async function miDia(c: Cliente, trabajadorId: string): Promise<MiDia> {
  const { rows: [t] } = await c.query(
    `SELECT t.id, t.numero, t.nombre, t.modalidades::text[] AS modalidades, ct.nombre AS centro,
            ct.lat AS centro_lat, ct.lng AS centro_lng, ct.radio_m
       FROM trabajadores t LEFT JOIN centros ct ON ct.id = t.centro_id WHERE t.id = $1 AND t.activo`, [trabajadorId]);
  if (!t) throw prohibido('Su ficha de trabajador está dada de baja');
  const fecha = await fechaLocal(c);
  const checadas = (await bitacora(c, { trabajadorId, fecha })).map(({ trabajador_id: _a, trabajador: _b, numero: _c, ...r }) => r);
  const { rows: [m] } = await c.query<{ minutos: number }>(
    `SELECT COALESCE((SELECT sum(minutos) FROM v_tramos WHERE trabajador_id = $1 AND fecha = $2), 0)
          + COALESCE((SELECT LEAST(extract(epoch FROM now() - u.ocurrido_en) / 60, 960)::int
                        FROM (SELECT tipo, ocurrido_en FROM v_checadas WHERE trabajador_id = $1 AND fecha = $2
                               ORDER BY ocurrido_en DESC LIMIT 1) u
                       WHERE u.tipo IN ('ENTRADA', 'FIN_DESCANSO')), 0) AS minutos`, [trabajadorId, fecha]);
  return { trabajador: t, fecha, siguientes: await siguientes(c, trabajadorId), bitacora: checadas, minutos_hoy: m.minutos };
}

export function rutasTrabajador(app: FastifyInstance, { sesiones }: Deps) {
  app.get('/api/yo/dia', (req) => sesiones.conMiembro(req, null, (c, m) => miDia(c, trabajadorDe(m))));

  app.post('/api/yo/checadas', async (req, reply) => {
    const b = E.Checar.parse(req.body);
    const r = await sesiones.conMiembro(req, null, (c, m) =>
      insertarChecada(c, m.empresaId, { ...b, trabajadorId: trabajadorDe(m), medio: 'CELULAR', cuentaId: m.cuentaId }));
    return reply.status(r.duplicado ? 200 : 201).send(r);
  });

  /**
   * Checadas guardadas sin señal. Se aplican en orden cronológico, cada una en
   * su SAVEPOINT (una rechazada no tumba a las demás). Reenviar es seguro.
   */
  app.post('/api/yo/checadas/lote', async (req) => {
    const { checadas } = E.Lote.parse(req.body);
    const resultados = await sesiones.conMiembro(req, null, async (c, m) => {
      const trabajadorId = trabajadorDe(m);
      const out: ResultadoLote[] = [];
      for (const ch of [...checadas].sort((a, b) => Date.parse(a.ocurrido_en) - Date.parse(b.ocurrido_en))) {
        await c.query('SAVEPOINT ch');
        try {
          const r = await insertarChecada(c, m.empresaId, { ...ch, trabajadorId, medio: 'CELULAR', cuentaId: m.cuentaId });
          await c.query('RELEASE SAVEPOINT ch');
          out.push({ client_uuid: ch.client_uuid, estado: r.duplicado ? 'DUPLICADA' : 'ACEPTADA', id: r.id });
        } catch (err) {
          await c.query('ROLLBACK TO SAVEPOINT ch');
          out.push({ client_uuid: ch.client_uuid, estado: 'RECHAZADA', motivo: motivoDe(err) });
        }
      }
      return out;
    });
    return { resultados };
  });

  app.get('/api/yo/periodos', (req) => sesiones.conMiembro(req, null, async (c, m) => {
    const { rows } = await c.query<MiPeriodo>(
      `SELECT p.id, p.nombre, p.inicio, p.fin, round(pt.minutos_trabajados / 60.0, 2)::float8 AS horas, pt.dias_trabajados,
              pt.retardos, pt.incidencias, pt.correcciones, pt.jornadas_abiertas, pt.respuesta, pt.comentario, pt.respondido_en
         FROM periodo_trabajadores pt JOIN periodos p ON p.id = pt.periodo_id
        WHERE pt.trabajador_id = $1 ORDER BY p.inicio DESC LIMIT 26`, [trabajadorDe(m)]);
    return rows;
  }));

  app.post<{ Params: { id: string } }>('/api/yo/periodos/:id/respuesta', (req) => {
    const b = E.Respuesta.parse(req.body);
    return sesiones.conMiembro(req, null, async (c, m) => {
      const { rowCount } = await c.query(
        `UPDATE periodo_trabajadores SET respuesta = $3, comentario = $4, respondido_en = now()
          WHERE periodo_id = $1 AND trabajador_id = $2`,
        [req.params.id, trabajadorDe(m), b.acepta ? 'ACEPTADO' : 'OBJETADO', b.comentario || null]);
      if (!rowCount) throw noEncontrado('No hay un periodo cerrado con su asistencia');
      return { ok: true, respuesta: b.acepta ? 'ACEPTADO' : 'OBJETADO' };
    });
  });
}
