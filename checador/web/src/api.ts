// Cliente del API. El token de sesión vive en localStorage del navegador.
import type { InfoSesion } from '../../server/src/tipos';

export class ApiError extends Error {
  constructor(public status: number, mensaje: string, public campos?: { campo: string; mensaje: string }[]) {
    super(mensaje);
  }
}
/** No hubo respuesta del servidor (sin señal, servidor caído). */
export class SinConexion extends Error {
  constructor() {
    super('Sin conexión');
    this.name = 'SinConexion';
  }
}

const leer = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const escribir = (k: string, v: string | null) => {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* modo privado */ }
};

export const token = {
  get: () => leer('checador:token'),
  set: (t: string | null) => escribir('checador:token', t),
};
export const tokenKiosco = {
  get: () => leer('checador:kiosco'),
  set: (t: string | null) => escribir('checador:kiosco', t),
};

let alExpirar: () => void = () => undefined;
export const onSesionVencida = (fn: () => void) => { alExpirar = fn; };

export async function api<T>(ruta: string, op: { metodo?: string; body?: unknown; kiosco?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (op.body !== undefined) headers['content-type'] = 'application/json';
  const t = op.kiosco ? tokenKiosco.get() : token.get();
  if (t) headers[op.kiosco ? 'x-kiosco' : 'authorization'] = op.kiosco ? t : `Bearer ${t}`;
  let res: Response;
  try {
    res = await fetch(ruta, { method: op.metodo ?? (op.body !== undefined ? 'POST' : 'GET'), headers,
      body: op.body !== undefined ? JSON.stringify(op.body) : undefined });
  } catch {
    throw new SinConexion();
  }
  const cuerpo = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !op.kiosco && ruta !== '/api/sesion') alExpirar();
    throw new ApiError(res.status, cuerpo.mensaje ?? `Error ${res.status}`, cuerpo.campos);
  }
  return cuerpo as T;
}

/** Descarga un archivo autenticado (CSV de un periodo). */
export async function descargar(ruta: string, nombre: string) {
  const res = await fetch(ruta, { headers: { authorization: `Bearer ${token.get()}` } });
  if (!res.ok) throw new ApiError(res.status, 'No se pudo descargar');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function entrar(email: string, password: string) {
  const s = await api<InfoSesion & { token: string }>('/api/sesion', { body: { email, password } });
  token.set(s.token);
  return s;
}

export async function cambiarEmpresa(empresaId: string) {
  const s = await api<InfoSesion & { token: string }>('/api/sesion/empresa', { body: { empresa_id: empresaId } });
  token.set(s.token);
  return s;
}

export const mensajeDe = (e: unknown) =>
  e instanceof SinConexion ? 'Sin conexión con el servidor' : e instanceof Error ? e.message : 'Error inesperado';
