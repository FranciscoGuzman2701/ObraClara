import { File } from 'expo-file-system';
import type {
  ComandoSync, ConfirmarArchivoInput, ObraResumen, PrefirmarInput, ResultadoComando, SesionUsuario, SnapshotObra,
} from '@obraclara/contracts';
import { SinConexion, Transporte } from './outbox';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

async function llamar<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
    });
  } catch {
    throw new SinConexion('Sin conexión con el servidor');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.mensaje ?? body.message ?? `Error ${res.status}`);
  return body as T;
}

export const login = (email: string) =>
  llamar<SesionUsuario>('/v1/auth/dev-login', null, { method: 'POST', body: JSON.stringify({ email }) });
export const obras = (token: string) => llamar<ObraResumen[]>('/v1/obras', token);
export const pull = (token: string, obraId: string) => llamar<SnapshotObra>(`/v1/sync/pull/${obraId}`, token);

export function transporteHttp(token: string): Transporte {
  return {
    push: async (comandos: ComandoSync[]) =>
      (await llamar<{ resultados: ResultadoComando[] }>('/v1/sync/push', token, {
        method: 'POST', body: JSON.stringify({ comandos }),
      })).resultados,
    prefirmar: (input: PrefirmarInput) =>
      llamar('/v1/archivos/prefirmar', token, { method: 'POST', body: JSON.stringify(input) }),
    async subir(url, uri, headers) {
      let res: Response;
      try {
        // File de expo-file-system implementa Blob: el binario va directo al bucket
        res = await fetch(url, { method: 'PUT', headers, body: new File(uri) });
      } catch {
        throw new SinConexion('Sin conexión al subir foto');
      }
      if (!res.ok) throw new Error(`Subida rechazada (${res.status})`);
    },
    confirmar: async (input: ConfirmarArchivoInput) => {
      await llamar('/v1/archivos/confirmar', token, { method: 'POST', body: JSON.stringify(input) });
    },
  };
}
