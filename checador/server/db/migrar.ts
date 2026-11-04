// Aplica las migraciones SQL de server/db/migrations en orden, una sola vez cada una.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const MIGRACIONES = path.join(DIR, 'migrations');
export const SEED = path.join(DIR, 'seed.sql');

export async function migrar(url: string, log: (m: string) => void = console.log): Promise<string[]> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(`CREATE TABLE IF NOT EXISTS public.checador_migraciones (
      nombre text PRIMARY KEY, aplicada_en timestamptz NOT NULL DEFAULT now())`);
    await c.query('SELECT pg_advisory_lock(424242)');
    const { rows } = await c.query<{ nombre: string }>('SELECT nombre FROM public.checador_migraciones');
    const hechas = new Set(rows.map((r) => r.nombre));
    const nuevas: string[] = [];
    for (const f of (await readdir(MIGRACIONES)).filter((f) => f.endsWith('.sql')).sort()) {
      if (hechas.has(f)) continue;
      await c.query('BEGIN');
      try {
        await c.query(await readFile(path.join(MIGRACIONES, f), 'utf8'));
        await c.query('INSERT INTO public.checador_migraciones(nombre) VALUES ($1)', [f]);
        await c.query('COMMIT');
      } catch (err) {
        await c.query('ROLLBACK');
        throw new Error(`Migración ${f} falló: ${(err as Error).message}`, { cause: err });
      }
      nuevas.push(f);
      log(`  ✔ ${f}`);
    }
    if (!nuevas.length) log('  (sin migraciones pendientes)');
    return nuevas;
  } finally {
    await c.query('SELECT pg_advisory_unlock(424242)').catch(() => undefined);
    await c.end();
  }
}

export async function ejecutarArchivo(url: string, archivo: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(await readFile(archivo, 'utf8'));
  } finally {
    await c.end();
  }
}

/** Borra el esquema del checador (sólo desarrollo / pruebas). */
export async function borrar(url: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('DROP SCHEMA IF EXISTS checador CASCADE; DROP TABLE IF EXISTS public.checador_migraciones');
  } finally {
    await c.end();
  }
}
