import type { FastifyInstance } from 'fastify';
import { crearApp } from '../src/app.js';
import { borrar, ejecutarArchivo, migrar, SEED } from '../db/migrar.js';

// Siempre contra una base de pruebas desechable, nunca la de desarrollo.
export const URL_PRUEBAS = process.env.TEST_DATABASE_URL ?? 'postgres://obraclara@localhost:5432/checador_test';

export async function prepararApp(): Promise<FastifyInstance> {
  await borrar(URL_PRUEBAS);
  await migrar(URL_PRUEBAS, () => undefined);
  await ejecutarArchivo(URL_PRUEBAS, SEED);
  return crearApp({ puerto: 0, databaseUrl: URL_PRUEBAS, jwtSecret: 'secreto-de-pruebas', produccion: false, webDist: undefined },
    { log: false });
}

export interface Respuesta { status: number; body: any; texto: string; headers: Record<string, unknown> }

export function cliente(app: FastifyInstance) {
  const pedir = async (metodo: 'GET' | 'POST' | 'PATCH', url: string, op: { token?: string; kiosco?: string; body?: unknown } = {}) => {
    const r = await app.inject({
      method: metodo, url, payload: op.body as object | undefined,
      headers: { ...(op.token ? { authorization: `Bearer ${op.token}` } : {}), ...(op.kiosco ? { 'x-kiosco': op.kiosco } : {}) },
    });
    let body: unknown = null;
    try { body = r.json(); } catch { /* csv */ }
    return { status: r.statusCode, body, texto: r.body, headers: r.headers } as Respuesta;
  };
  return {
    pedir,
    async entrar(email: string, password = 'demo1234') {
      const r = await pedir('POST', '/api/sesion', { body: { email, password } });
      if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${r.texto}`);
      return r.body.token as string;
    },
  };
}

export const haceMin = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
export const diaLocal = (dias: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(Date.now() + dias * 86_400_000));
