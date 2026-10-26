// Runner de migraciones SQL de ObraClara.
// Cada archivo de migrations/ se aplica una sola vez, en orden, dentro de su
// propia transacción, y queda registrado en public.schema_migrations.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
export const SEED_FILE = path.join(ROOT, 'seed_dev.sql');
export const DEMO_FILE = path.join(ROOT, 'demo_flujo.sql');

/** @param {string} databaseUrl @param {{log?: (msg: string) => void}} [opts] */
export async function migrate(databaseUrl, opts = {}) {
  const log = opts.log ?? console.log;
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      nombre text PRIMARY KEY, aplicada_en timestamptz NOT NULL DEFAULT now())`);
    // un solo runner a la vez (despliegues concurrentes)
    await client.query('SELECT pg_advisory_lock(727210)');
    const { rows } = await client.query('SELECT nombre FROM public.schema_migrations');
    const aplicadas = new Set(rows.map((r) => r.nombre));
    const archivos = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const nuevas = [];
    for (const archivo of archivos) {
      if (aplicadas.has(archivo)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, archivo), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO public.schema_migrations(nombre) VALUES ($1)', [archivo]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migración ${archivo} falló: ${err.message}`, { cause: err });
      }
      nuevas.push(archivo);
      log(`  ✔ ${archivo}`);
    }
    if (nuevas.length === 0) log('  (sin migraciones pendientes)');
    return nuevas;
  } finally {
    await client.query('SELECT pg_advisory_unlock(727210)').catch(() => {});
    await client.end();
  }
}

/** Ejecuta un archivo .sql completo (seed). @param {string} databaseUrl @param {string} file */
export async function runSqlFile(databaseUrl, file) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(await readFile(file, 'utf8'));
  } finally {
    await client.end();
  }
}

/** Crea (o recrea) una base vacía. Útil para pruebas. @param {string} databaseUrl */
export async function recreateDatabase(databaseUrl) {
  const url = new URL(databaseUrl);
  const dbName = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error(`Nombre de base inválido: ${dbName}`);
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
  } finally {
    await admin.end();
  }
}
