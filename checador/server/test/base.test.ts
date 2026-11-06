import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/db.js';
import { borrar, ejecutarArchivo, migrar, SEED } from '../db/migrar.js';
import { URL_PRUEBAS } from './ayuda.js';

// Las garantías que no dependen del código del servidor: las da PostgreSQL.
const P3 = { empresaId: '00000000-0000-4000-8000-0000000000a1', cuentaId: '00000000-0000-4000-8000-0000000000b2' };
const E2 = { empresaId: '00000000-0000-4000-8000-0000000000a2', cuentaId: '00000000-0000-4000-8000-0000000000b7' };
let db: Db;

before(async () => {
  await borrar(URL_PRUEBAS);
  await migrar(URL_PRUEBAS, () => undefined);
  await ejecutarArchivo(URL_PRUEBAS, SEED);
  db = new Db(URL_PRUEBAS);
});
after(() => db.cerrar());

const rechaza = async (ctx: typeof P3, sql: string, patron: RegExp) =>
  assert.rejects(db.empresa(ctx, (c) => c.query(sql)), patron);

describe('base de datos', () => {
  it('cada empresa sólo ve sus filas, aunque la consulta no filtre', async () => {
    const n = (ctx: typeof P3) => db.empresa(ctx, async (c) => (await c.query(
      `SELECT (SELECT count(*) FROM empresas) AS e, (SELECT count(*) FROM trabajadores) AS t,
              (SELECT count(DISTINCT empresa_id) FROM checadas) AS ce`)).rows[0]);
    assert.deepEqual(await n(P3), { e: 1, t: 6, ce: 1 });
    assert.deepEqual(await n(E2), { e: 1, t: 2, ce: 1 });
  });

  it('el rol de aplicación no puede leer cuentas (contraseñas)', async () => {
    await rechaza(P3, 'SELECT * FROM cuentas', /permission denied/);
  });

  it('no se puede insertar en nombre de otra empresa', async () => {
    await rechaza(P3, `INSERT INTO centros(empresa_id, clave, nombre) VALUES ('${E2.empresaId}', 'X', 'Ajeno')`,
      /row-level security/);
  });

  it('las checadas no se editan ni se borran', async () => {
    await rechaza(P3, 'UPDATE checadas SET ocurrido_en = now()', /permission denied/);
    await rechaza(P3, 'DELETE FROM checadas', /permission denied/);
    await rechaza(P3, 'DELETE FROM checadas_anuladas', /permission denied/);
  });

  it('los números congelados de un periodo no se pueden cambiar', async () => {
    await rechaza(P3, 'UPDATE periodo_trabajadores SET minutos_trabajados = 99999', /permission denied/);
  });

  it('una corrección sin motivo no entra', async () => {
    await rechaza(P3, `INSERT INTO checadas(empresa_id, trabajador_id, tipo, medio, ocurrido_en, cuenta_id)
      VALUES ('${P3.empresaId}', '00000000-0000-4000-8000-0000000000d3', 'SALIDA', 'SUPERVISOR', now(), '${P3.cuentaId}')`,
      /checada_supervisor_con_motivo/);
  });

  it('la aplicación no puede activar el modo de carga histórica para saltarse las reglas', async () => {
    await rechaza(P3, `SELECT set_config('checador.importacion', 'on', true);
      INSERT INTO checadas(empresa_id, trabajador_id, tipo, medio, modalidad, ocurrido_en, cuenta_id)
      VALUES ('${P3.empresaId}', '00000000-0000-4000-8000-0000000000d3', 'SALIDA', 'CELULAR', 'DESDE_CASA',
              now() - interval '3 hours', '${P3.cuentaId}')`, /se necesita una foto|límite es 48 h/);
  });

  it('las fotos de una empresa no se ven desde otra', async () => {
    const id = await db.empresa(P3, async (c) => (await c.query(
      `INSERT INTO fotos(empresa_id, mime, datos) VALUES ($1, 'image/jpeg', $2) RETURNING id`,
      [P3.empresaId, Buffer.alloc(2000, 0xff)])).rows[0].id);
    const ver = (ctx: typeof P3) => db.empresa(ctx, async (c) => (await c.query('SELECT count(*) AS n FROM fotos WHERE id = $1', [id])).rows[0].n);
    assert.equal(await ver(P3), 1);
    assert.equal(await ver(E2), 0);
  });
});
