import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.js';
import { HttpError, prohibido } from '../errores.js';
import * as E from '../esquemas.js';
import type { InfoSesion } from '../tipos.js';

export function rutasSesion(app: FastifyInstance, { db, sesiones, freno }: Deps) {
  /** Todo lo que la web necesita saber de la sesión: cuenta, empresa actual, rol y a qué empresas puede cambiar. */
  const info = (cuentaId: string, empresaId: string) => db.sistema(async (c): Promise<InfoSesion> => {
    const { rows: empresas } = await c.query(
      `SELECT e.id, e.clave, e.nombre, e.zona_horaria, m.rol, m.trabajador_id, e.id = $2 AS actual
         FROM membresias m JOIN empresas e ON e.id = m.empresa_id JOIN cuentas cu ON cu.id = m.cuenta_id
        WHERE m.cuenta_id = $1 AND m.activa AND cu.activa
        ORDER BY e.clave`, [cuentaId, empresaId]);
    const actual = empresas.find((e) => e.actual);
    if (!actual) throw new HttpError(401, 'Ya no tiene acceso a esta empresa');
    const { rows: [cuenta] } = await c.query('SELECT id, nombre, email FROM cuentas WHERE id = $1', [cuentaId]);
    let trabajador: InfoSesion['trabajador'] = null;
    if (actual.trabajador_id) {
      const { rows: [t] } = await c.query(
        `SELECT t.id, t.numero, t.nombre, t.modalidades::text[] AS modalidades, ct.nombre AS centro
           FROM trabajadores t LEFT JOIN centros ct ON ct.id = t.centro_id WHERE t.id = $1 AND t.activo`,
        [actual.trabajador_id]);
      trabajador = t ?? null;
    }
    return {
      cuenta,
      empresa: { id: actual.id, clave: actual.clave, nombre: actual.nombre, zona_horaria: actual.zona_horaria },
      rol: actual.rol,
      trabajador,
      empresas: empresas.map(({ id, clave, nombre, rol, actual: a }) => ({ id, clave, nombre, rol, actual: a })),
    };
  });

  app.post('/api/sesion', async (req) => {
    const { email, password } = E.Login.parse(req.body);
    const clave = `${email.toLowerCase()}|${req.ip}`;
    freno.revisar(clave);
    const r = await db.sistema(async (c) => {
      const { rows: [cu] } = await c.query<{ id: string }>(
        `SELECT id FROM cuentas WHERE lower(email) = lower($1) AND activa AND password_hash = crypt($2, password_hash)`,
        [email, password]);
      if (!cu) return null;
      const { rows: [m] } = await c.query<{ empresa_id: string }>(
        `SELECT m.empresa_id FROM membresias m JOIN empresas e ON e.id = m.empresa_id
          WHERE m.cuenta_id = $1 AND m.activa ORDER BY e.clave LIMIT 1`, [cu.id]);
      return { cuentaId: cu.id, empresaId: m?.empresa_id };
    });
    if (!r) {
      freno.fallo(clave);
      throw new HttpError(401, 'Correo o contraseña incorrectos');
    }
    freno.exito(clave);
    if (!r.empresaId) throw prohibido('Su cuenta no tiene acceso a ninguna empresa');
    return { token: await sesiones.firmar(r.cuentaId, r.empresaId), ...(await info(r.cuentaId, r.empresaId)) };
  });

  app.get('/api/sesion', async (req) => {
    const s = await sesiones.leer(req);
    return info(s.cuentaId, s.empresaId);
  });

  /** Cambia a otra empresa de la misma cuenta: token nuevo, sin volver a escribir la contraseña. */
  app.post('/api/sesion/empresa', async (req) => {
    const s = await sesiones.leer(req);
    const { empresa_id } = E.CambiarEmpresa.parse(req.body);
    const datos = await info(s.cuentaId, s.empresaId);
    if (!datos.empresas.some((e) => e.id === empresa_id)) throw prohibido('No tiene acceso a esa empresa');
    return { token: await sesiones.firmar(s.cuentaId, empresa_id), ...(await info(s.cuentaId, empresa_id)) };
  });

  app.post('/api/sesion/password', async (req) => {
    const s = await sesiones.leer(req);
    const { actual, nueva } = E.CambiarPassword.parse(req.body);
    const ok = await db.sistema(async (c) => (await c.query(
      `UPDATE cuentas SET password_hash = crypt($3, gen_salt('bf', 10))
        WHERE id = $1 AND password_hash = crypt($2, password_hash)`, [s.cuentaId, actual, nueva])).rowCount);
    if (!ok) throw new HttpError(422, 'La contraseña actual no coincide');
    return { ok: true };
  });
}
