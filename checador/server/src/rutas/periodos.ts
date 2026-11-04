import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.js';
import { noEncontrado } from '../errores.js';
import * as E from '../esquemas.js';
import type { FilaPeriodo, Periodo } from '../tipos.js';

const csv = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function rutasPeriodos(app: FastifyInstance, { sesiones }: Deps) {
  app.get('/api/periodos', (req) => sesiones.conMiembro(req, 'gestionar', async (c) =>
    (await c.query<Periodo>(
      `SELECT p.id, p.nombre, p.inicio, p.fin, p.estado, p.cerrado_en,
              count(pt.trabajador_id)::int AS trabajadores,
              count(*) FILTER (WHERE pt.respuesta = 'ACEPTADO')::int AS aceptados,
              count(*) FILTER (WHERE pt.respuesta = 'OBJETADO')::int AS objetados
         FROM periodos p LEFT JOIN periodo_trabajadores pt ON pt.periodo_id = p.id
        GROUP BY p.id ORDER BY p.inicio DESC`)).rows));

  app.post('/api/periodos', async (req, reply) => {
    const b = E.NuevoPeriodo.parse(req.body);
    const r = await sesiones.conMiembro(req, 'gestionar', async (c, m) => (await c.query<{ id: string }>(
      'INSERT INTO periodos(empresa_id, nombre, inicio, fin) VALUES ($1, $2, $3, $4) RETURNING id',
      [m.empresaId, b.nombre, b.inicio, b.fin])).rows[0]);
    return reply.status(201).send(r);
  });

  /** Congela horas, retardos e incidencias por trabajador; después nadie puede checar ni corregir dentro del periodo. */
  app.post<{ Params: { id: string } }>('/api/periodos/:id/cerrar', (req) => sesiones.conMiembro(req, 'gestionar', async (c, m) => {
    const { rows: [r] } = await c.query<{ n: number }>('SELECT cerrar_periodo($1, $2) AS n', [req.params.id, m.cuentaId]);
    return { trabajadores: r.n };
  }));

  const detalle = (id: string) => `
    SELECT t.id AS trabajador_id, t.numero, t.nombre, round(pt.minutos_trabajados / 60.0, 2)::float8 AS horas,
           pt.dias_trabajados, pt.retardos, pt.incidencias, pt.correcciones, pt.jornadas_abiertas,
           pt.respuesta, pt.comentario, pt.respondido_en
      FROM periodo_trabajadores pt JOIN trabajadores t ON t.id = pt.trabajador_id
     WHERE pt.periodo_id = ${id} ORDER BY t.numero`;

  app.get<{ Params: { id: string } }>('/api/periodos/:id', (req) => sesiones.conMiembro(req, 'gestionar', async (c) => {
    const { rows: [p] } = await c.query<Periodo>(
      'SELECT id, nombre, inicio, fin, estado, cerrado_en FROM periodos WHERE id = $1', [req.params.id]);
    if (!p) throw noEncontrado('Periodo no encontrado');
    const { rows } = await c.query<FilaPeriodo>(detalle('$1'), [req.params.id]);
    return { periodo: p, trabajadores: rows };
  }));

  /** Para nómina: una fila por trabajador del periodo cerrado. */
  app.get<{ Params: { id: string } }>('/api/periodos/:id/csv', async (req, reply) => {
    const { p, rows } = await sesiones.conMiembro(req, 'gestionar', async (c) => {
      const { rows: [p] } = await c.query('SELECT nombre, inicio, fin FROM periodos WHERE id = $1', [req.params.id]);
      if (!p) throw noEncontrado('Periodo no encontrado');
      return { p, rows: (await c.query<FilaPeriodo>(detalle('$1'), [req.params.id])).rows };
    });
    const encabezado = ['numero', 'nombre', 'horas', 'dias_trabajados', 'retardos', 'incidencias', 'correcciones',
                        'jornadas_sin_salida', 'respuesta', 'comentario'];
    const lineas = rows.map((r) => [r.numero, r.nombre, r.horas, r.dias_trabajados, r.retardos, r.incidencias,
                                    r.correcciones, r.jornadas_abiertas, r.respuesta ?? 'PENDIENTE', r.comentario].map(csv).join(','));
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="asistencia_${p.inicio}_${p.fin}.csv"`)
      .send('﻿' + [encabezado.join(','), ...lineas].join('\r\n') + '\r\n');
  });
}
