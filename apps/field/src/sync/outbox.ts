// Bandeja de salida offline. Independiente de React Native para poder
// probarla en Node: el almacenamiento (SQLite) y el transporte (HTTP) se inyectan.
//
// Orden de trabajo en cada sincronización:
//   1. Comandos PENDIENTES → POST /sync/push (en lotes). Cada uno vuelve
//      ACEPTADO / DUPLICADO (ya estaba: también vale) / RECHAZADO con motivo.
//   2. Fotos cuyo comando ya tiene id en el servidor → prefirmar → PUT directo
//      al bucket → confirmar. Las fotos de comandos rechazados se descartan.
// Si se cae la red a la mitad, lo no confirmado queda PENDIENTE y se reintenta.
import type {
  ComandoSync, ConfirmarArchivoInput, PrefirmarInput, ResultadoComando,
} from '@obraclara/contracts';

export type EstadoLocal = 'PENDIENTE' | 'ACEPTADO' | 'DUPLICADO' | 'RECHAZADO';

export interface ComandoLocal {
  comando: ComandoSync;
  estado: EstadoLocal;
  id_servidor: string | null;
  motivo: string | null;
  intentos: number;
}

export type EstadoFoto = 'PENDIENTE' | 'SUBIDA' | 'DESCARTADA';

export interface FotoLocal {
  id: string;
  comando_uuid: string;
  entidad_tipo: ConfirmarArchivoInput['entidad_tipo'];
  uri: string;
  mime: PrefirmarInput['mime'];
  bytes: number;
  sha256: string;
  tomada_en: string;
  lat: number | null;
  lng: number | null;
  estado: EstadoFoto;
  error: string | null;
  intentos: number;
}

export interface OutboxStore {
  comandosPendientes(): Promise<ComandoLocal[]>;
  comando(clientUuid: string): Promise<ComandoLocal | null>;
  actualizarComando(clientUuid: string, cambios: Partial<Omit<ComandoLocal, 'comando'>>): Promise<void>;
  fotosPendientes(): Promise<FotoLocal[]>;
  actualizarFoto(id: string, cambios: Partial<Pick<FotoLocal, 'estado' | 'error' | 'intentos'>>): Promise<void>;
}

export interface Transporte {
  push(comandos: ComandoSync[]): Promise<ResultadoComando[]>;
  prefirmar(input: PrefirmarInput): Promise<{ archivo_id: string; upload_url: string; headers: Record<string, string> }>;
  subir(url: string, uri: string, headers: Record<string, string>): Promise<void>;
  confirmar(input: ConfirmarArchivoInput): Promise<void>;
}

/** Error de red (sin señal, timeout): detiene la sincronización sin marcar nada como fallido. */
export class SinConexion extends Error {}

export interface ResumenSync {
  enviados: number;
  aceptados: number;
  rechazados: number;
  fotosSubidas: number;
  fotosDescartadas: number;
  sinConexion: boolean;
}

export async function sincronizar(store: OutboxStore, t: Transporte, opts: { lote?: number } = {}): Promise<ResumenSync> {
  const lote = opts.lote ?? 50;
  const r: ResumenSync = { enviados: 0, aceptados: 0, rechazados: 0, fotosSubidas: 0, fotosDescartadas: 0, sinConexion: false };

  try {
    const pendientes = await store.comandosPendientes();
    for (let i = 0; i < pendientes.length; i += lote) {
      const grupo = pendientes.slice(i, i + lote);
      let resultados: ResultadoComando[];
      try {
        resultados = await t.push(grupo.map((c) => c.comando));
      } catch (err) {
        for (const c of grupo) await store.actualizarComando(c.comando.client_uuid, { intentos: c.intentos + 1 });
        throw err;
      }
      r.enviados += grupo.length;
      for (const res of resultados) {
        const previo = grupo.find((c) => c.comando.client_uuid === res.client_uuid);
        await store.actualizarComando(res.client_uuid, {
          estado: res.estado,
          id_servidor: res.id ?? null,
          motivo: res.motivo ?? null,
          intentos: (previo?.intentos ?? 0) + 1,
        });
        if (res.estado === 'RECHAZADO') r.rechazados++;
        else r.aceptados++;
      }
    }

    for (const foto of await store.fotosPendientes()) {
      const cmd = await store.comando(foto.comando_uuid);
      if (!cmd || cmd.estado === 'PENDIENTE') continue; // aún no existe en el servidor
      if (cmd.estado === 'RECHAZADO' || !cmd.id_servidor) {
        await store.actualizarFoto(foto.id, { estado: 'DESCARTADA', error: cmd.motivo ?? 'Registro rechazado' });
        r.fotosDescartadas++;
        continue;
      }
      try {
        const pre = await t.prefirmar({ obra_id: cmd.comando.obra_id, mime: foto.mime, bytes: foto.bytes, sha256: foto.sha256 });
        await t.subir(pre.upload_url, foto.uri, pre.headers);
        await t.confirmar({
          archivo_id: pre.archivo_id,
          entidad_tipo: foto.entidad_tipo,
          entidad_id: cmd.id_servidor,
          tomada_en: foto.tomada_en,
          ...(foto.lat != null && foto.lng != null ? { lat: foto.lat, lng: foto.lng } : {}),
        });
        await store.actualizarFoto(foto.id, { estado: 'SUBIDA', error: null, intentos: foto.intentos + 1 });
        r.fotosSubidas++;
      } catch (err) {
        if (err instanceof SinConexion) throw err;
        // error del servidor: se reintenta en la próxima sincronización
        await store.actualizarFoto(foto.id, { error: (err as Error).message, intentos: foto.intentos + 1 });
      }
    }
  } catch (err) {
    if (!(err instanceof SinConexion)) throw err;
    r.sinConexion = true;
  }
  return r;
}
