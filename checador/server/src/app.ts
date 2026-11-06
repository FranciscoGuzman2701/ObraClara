import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { Config } from './config.js';
import { Db } from './db.js';
import { manejador } from './errores.js';
import { Freno, Sesiones } from './sesion.js';
import { rutasSesion } from './rutas/sesion.js';
import { rutasTrabajador } from './rutas/trabajador.js';
import { rutasKiosco } from './rutas/kiosco.js';
import { rutasEquipo } from './rutas/equipo.js';
import { rutasCatalogos } from './rutas/catalogos.js';
import { rutasPeriodos } from './rutas/periodos.js';

export interface Deps {
  db: Db;
  sesiones: Sesiones;
  freno: Freno;
}

export async function crearApp(config: Config, opciones: { log?: boolean } = {}) {
  // las checadas sin señal pueden traer fotos (≈50 KB c/u, hasta 60 por lote)
  const app = Fastify({ logger: opciones.log ?? true, trustProxy: true, bodyLimit: 8 * 1024 * 1024 });
  const db = new Db(config.databaseUrl);
  const deps: Deps = { db, sesiones: new Sesiones(config.jwtSecret, db), freno: new Freno(8, 15 * 60_000) };

  app.setErrorHandler(manejador);
  app.addHook('onClose', () => db.cerrar());
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
  });

  app.get('/api/salud', async () => {
    await db.pool.query('SELECT 1');
    return { ok: true };
  });
  for (const r of [rutasSesion, rutasTrabajador, rutasKiosco, rutasEquipo, rutasCatalogos, rutasPeriodos]) r(app, deps);
  app.all('/api/*', async (_req, reply) => reply.status(404).send({ mensaje: 'Ruta no encontrada' }));

  // la web compilada (SPA): cualquier otra ruta devuelve index.html
  if (config.webDist && existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: path.resolve(config.webDist) });
    app.setNotFoundHandler((_req, reply) => reply.sendFile('index.html'));
  }
  return app;
}
