import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import type { Cliente } from '../db.js';
import { invalido, noEncontrado, prohibido } from '../errores.js';
import * as E from '../esquemas.js';
import type { Centro, Dispositivo, Trabajador, Usuario } from '../tipos.js';

/** UPDATE con sólo los campos presentes. `mapa` traduce campo → expresión SQL ($n se asigna aquí). */
async function actualizar(c: Cliente, tabla: string, id: string, campos: Record<string, unknown>,
                          expr: Record<string, (p: string) => string> = {}) {
  const sets: string[] = [];
  const vals: unknown[] = [id];
  for (const [k, v] of Object.entries(campos)) {
    if (v === undefined) continue;
    vals.push(v);
    sets.push(`${k} = ${expr[k] ? expr[k](`$${vals.length}`) : `$${vals.length}`}`);
  }
  if (!sets.length) return true;
  const { rowCount } = await c.query(`UPDATE ${tabla} SET ${sets.join(', ')} WHERE id = $1`, vals);
  return !!rowCount;
}

const PIN_SQL = (p: string) => `crypt(${p}, gen_salt('bf', 8))`;

export function rutasCatalogos(app: FastifyInstance, { sesiones }: Deps) {
  // ------------------------------------------------------------ empresa
  app.get('/api/empresa', (req) => sesiones.conMiembro(req, null, async (c) =>
    (await c.query('SELECT id, clave, nombre, rfc, zona_horaria, tolerancia_min, foto_sin_geocerca, ventana_diferida_h FROM empresas')).rows[0]));

  app.patch('/api/empresa', (req) => {
    const b = z.object({
      nombre: z.string().trim().min(2).max(120).optional(),
      rfc: z.string().trim().max(13).nullable().optional(),
      tolerancia_min: z.number().int().min(0).max(120).optional(),
      foto_sin_geocerca: z.boolean().optional(),
      ventana_diferida_h: z.number().int().min(1).max(168).optional(),
      zona_horaria: z.enum(['America/Mexico_City', 'America/Monterrey', 'America/Merida', 'America/Cancun',
                            'America/Chihuahua', 'America/Hermosillo', 'America/Mazatlan', 'America/Tijuana']).optional(),
    }).parse(req.body);
    return sesiones.conMiembro(req, 'administrar', async (c, m) => {
      await actualizar(c, 'empresas', m.empresaId, b);
      return { ok: true };
    });
  });

  // ------------------------------------------------------------ trabajadores
  app.get('/api/trabajadores', (req) => sesiones.conMiembro(req, 'verEquipo', async (c) => {
    const { rows } = await c.query<Trabajador>(
      `SELECT t.id, t.numero, t.nombre, t.puesto, t.centro_id, ct.nombre AS centro, t.modalidades::text[] AS modalidades,
              to_char(t.hora_entrada, 'HH24:MI') AS hora_entrada, t.jornada_min, t.pin_hash IS NOT NULL AS tiene_pin,
              COALESCE(t.bloqueado_hasta > now(), false) AS bloqueado, u.email AS cuenta_email, t.activo,
              t.dias_remotos::int[] AS dias_remotos, t.casa_actualizada_en,
              CASE WHEN t.casa_estado IS NOT NULL THEN json_build_object('lat', t.casa_lat, 'lng', t.casa_lng,
                'radio_m', t.casa_radio_m, 'direccion', t.casa_direccion, 'estado', t.casa_estado) END AS casa
         FROM trabajadores t LEFT JOIN centros ct ON ct.id = t.centro_id
         LEFT JOIN usuarios_empresa() u ON u.trabajador_id = t.id
        ORDER BY t.activo DESC, t.numero`);
    return rows;
  }));

  app.post('/api/trabajadores', async (req, reply) => {
    const b = E.NuevoTrabajador.parse(req.body);
    if (b.modalidades.includes('KIOSCO') && !b.pin) throw invalido('Para checar en kiosco necesita un PIN');
    const r = await sesiones.conMiembro(req, 'gestionar', async (c, m) => (await c.query<{ id: string }>(
      `INSERT INTO trabajadores(empresa_id, numero, nombre, puesto, centro_id, modalidades, hora_entrada, jornada_min, pin_hash,
                                dias_remotos)
       VALUES ($1, $2, $3, $4, $5, $6::modalidad[], $7, $8, CASE WHEN $9::text IS NULL THEN NULL ELSE crypt($9, gen_salt('bf', 8)) END,
               $10::smallint[])
       RETURNING id`,
      [m.empresaId, b.numero, b.nombre, b.puesto || null, b.centro_id ?? null, b.modalidades, b.hora_entrada ?? null,
       b.jornada_min, b.pin ?? null, b.dias_remotos ?? []])).rows[0]);
    return reply.status(201).send(r);
  });

  app.patch<{ Params: { id: string } }>('/api/trabajadores/:id', (req) => {
    const { pin, desbloquear, modalidades, casa, aprobar_casa, ...b } = E.EditarTrabajador.parse(req.body);
    return sesiones.conMiembro(req, 'gestionar', async (c, m) => {
      const campos: Record<string, unknown> = { ...b, pin_hash: pin, modalidades };
      if (desbloquear || pin) Object.assign(campos, { intentos_pin: 0, bloqueado_hasta: null });
      if (casa === null) {
        Object.assign(campos, { casa_lat: null, casa_lng: null, casa_direccion: null, casa_estado: null, casa_aprobada_por: null });
      } else if (casa) {
        // RH la captura o la corrige: queda aprobada por RH
        Object.assign(campos, { casa_lat: casa.lat, casa_lng: casa.lng, casa_radio_m: casa.radio_m,
          casa_direccion: casa.direccion ?? null, casa_estado: 'APROBADA', casa_aprobada_por: m.cuentaId,
          casa_actualizada_en: new Date().toISOString() });
      }
      const ok = await actualizar(c, 'trabajadores', req.params.id, campos, {
        pin_hash: PIN_SQL, modalidades: (p) => `${p}::modalidad[]`, dias_remotos: (p) => `${p}::smallint[]`,
      });
      if (aprobar_casa) {
        const { rowCount } = await c.query(
          `UPDATE trabajadores SET casa_estado = 'APROBADA', casa_aprobada_por = $2 WHERE id = $1 AND casa_estado = 'PROPUESTA'`,
          [req.params.id, m.cuentaId]);
        if (!rowCount) throw invalido('No hay una casa por aprobar');
      }
      if (!ok) throw noEncontrado('Trabajador no encontrado');
      const { rows: [t] } = await c.query<{ sin_pin: boolean }>(
        `SELECT 'KIOSCO' = ANY (modalidades) AND pin_hash IS NULL AS sin_pin FROM trabajadores WHERE id = $1`, [req.params.id]);
      if (t.sin_pin) throw invalido('Para checar en kiosco necesita un PIN');
      return { ok: true };
    });
  });

  // ------------------------------------------------------------ centros
  app.get('/api/centros', (req) => sesiones.conMiembro(req, 'verEquipo', async (c) =>
    (await c.query<Centro>('SELECT id, clave, nombre, direccion, lat, lng, radio_m, activo FROM centros ORDER BY activo DESC, clave')).rows));

  app.post('/api/centros', async (req, reply) => {
    const b = E.NuevoCentro.parse(req.body);
    const r = await sesiones.conMiembro(req, 'gestionar', async (c, m) => (await c.query<{ id: string }>(
      `INSERT INTO centros(empresa_id, clave, nombre, direccion, lat, lng, radio_m)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [m.empresaId, b.clave, b.nombre, b.direccion || null, b.lat ?? null, b.lng ?? null, b.radio_m])).rows[0]);
    return reply.status(201).send(r);
  });

  app.patch<{ Params: { id: string } }>('/api/centros/:id', (req) => {
    const b = E.EditarCentro.parse(req.body);
    return sesiones.conMiembro(req, 'gestionar', async (c) => {
      if (!(await actualizar(c, 'centros', req.params.id, b))) throw noEncontrado('Centro no encontrado');
      return { ok: true };
    });
  });

  // ------------------------------------------------------------ kioscos
  app.get('/api/dispositivos', (req) => sesiones.conMiembro(req, 'gestionar', async (c) =>
    (await c.query<Dispositivo>(
      `SELECT d.id, d.nombre, ct.nombre AS centro, d.creado_en, d.ultimo_uso, d.revocado_en
         FROM dispositivos d JOIN centros ct ON ct.id = d.centro_id ORDER BY d.revocado_en NULLS FIRST, d.creado_en DESC`)).rows));

  app.post<{ Params: { id: string } }>('/api/dispositivos/:id/revocar', (req) => sesiones.conMiembro(req, 'gestionar', async (c) => {
    const { rowCount } = await c.query('UPDATE dispositivos SET revocado_en = now() WHERE id = $1 AND revocado_en IS NULL',
      [req.params.id]);
    if (!rowCount) throw noEncontrado('Kiosco no encontrado o ya desactivado');
    return { ok: true };
  }));

  // ------------------------------------------------------------ usuarios (acceso a la empresa)
  app.get('/api/usuarios', (req) => sesiones.conMiembro(req, 'gestionar', async (c) =>
    (await c.query<Usuario>(
      `SELECT u.cuenta_id, u.nombre, u.email, u.rol, t.nombre AS trabajador, u.activa
         FROM usuarios_empresa() u LEFT JOIN trabajadores t ON t.id = u.trabajador_id
        ORDER BY u.activa DESC, u.rol, u.nombre`)).rows));

  /**
   * Da acceso a una persona. Si el correo ya tiene cuenta (p. ej. en otra empresa
   * del grupo) se reutiliza y conserva su contraseña; si no, se crea.
   * Sólo un ADMIN puede dar los roles ADMIN y RH. Cualquier rol puede ligarse a
   * una ficha de trabajador (un supervisor que también checa).
   */
  app.post('/api/usuarios', async (req, reply) => {
    const b = E.NuevoUsuario.parse(req.body);
    const r = await sesiones.conMiembro(req, 'gestionar', async (c, m) => {
      if ((b.rol === 'ADMIN' || b.rol === 'RH') && m.rol !== 'ADMIN') throw prohibido('Sólo un administrador puede dar ese rol');
      const { rows: [cu] } = await c.query<{ id: string }>('SELECT cuenta_para_alta($1, $2, $3) AS id',
        [b.email, b.nombre, b.password ?? null]);
      await c.query('INSERT INTO membresias(cuenta_id, empresa_id, rol, trabajador_id) VALUES ($1, $2, $3, $4)',
        [cu.id, m.empresaId, b.rol, b.trabajador_id ?? null]);
      return { cuenta_id: cu.id };
    });
    return reply.status(201).send(r);
  });

  app.patch<{ Params: { cuentaId: string } }>('/api/usuarios/:cuentaId', (req) => {
    const b = E.EditarUsuario.parse(req.body);
    return sesiones.conMiembro(req, 'gestionar', async (c, m) => {
      if (req.params.cuentaId === m.cuentaId) throw invalido('No puede cambiar su propio acceso');
      const { rows: [u] } = await c.query<{ rol: string }>('SELECT rol FROM membresias WHERE cuenta_id = $1', [req.params.cuentaId]);
      if (!u) throw noEncontrado('Usuario no encontrado');
      const tocaAltos = ['ADMIN', 'RH'].includes(u.rol) || (b.rol && ['ADMIN', 'RH'].includes(b.rol));
      if (tocaAltos && m.rol !== 'ADMIN') throw prohibido('Sólo un administrador puede cambiar ese acceso');
      await c.query('UPDATE membresias SET rol = COALESCE($2, rol), activa = COALESCE($3, activa) WHERE cuenta_id = $1',
        [req.params.cuentaId, b.rol ?? null, b.activa ?? null]);
      return { ok: true };
    });
  });
}
