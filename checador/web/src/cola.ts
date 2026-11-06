// Cola de checadas sin señal. Cada checada se guarda primero en el teléfono con
// su hora real y un client_uuid; se envía en lote cuando hay conexión. Reenviar
// es seguro: el servidor reconoce el client_uuid y no la duplica.
import type { Modalidad, ResultadoLote, TipoChecada } from '../../server/src/tipos';

export interface ChecadaLocal {
  client_uuid: string;
  tipo: TipoChecada;
  modalidad: Exclude<Modalidad, 'KIOSCO'>;
  ocurrido_en: string;
  lat?: number;
  lng?: number;
  precision_m?: number;
  /** selfie en base64, cuando la empresa la pide (desde casa / móvil) */
  foto?: { base64: string };
  estado: 'PENDIENTE' | 'RECHAZADA';
  motivo?: string;
}

export interface Almacen {
  leer(): ChecadaLocal[];
  guardar(lista: ChecadaLocal[]): void;
}

export const almacenNavegador = (clave: string): Almacen => ({
  leer() {
    try { return JSON.parse(localStorage.getItem(clave) ?? '[]'); } catch { return []; }
  },
  guardar(lista) {
    try { localStorage.setItem(clave, JSON.stringify(lista)); } catch { /* sin espacio / modo privado */ }
  },
});

/** Envía las pendientes. Devuelve cuántas quedaron registradas y si hubo conexión. */
export async function enviarCola(
  almacen: Almacen,
  enviar: (checadas: Omit<ChecadaLocal, 'estado' | 'motivo'>[]) => Promise<ResultadoLote[]>,
): Promise<{ enviadas: number; rechazadas: number; sinConexion: boolean }> {
  const pendientes = almacen.leer().filter((c) => c.estado === 'PENDIENTE');
  if (!pendientes.length) return { enviadas: 0, rechazadas: 0, sinConexion: false };
  let resultados: ResultadoLote[];
  try {
    resultados = await enviar(pendientes.map(({ estado: _e, motivo: _m, ...c }) => c));
  } catch (e) {
    if ((e as Error).name === 'SinConexion' || (e as Error).message === 'Sin conexión') {
      return { enviadas: 0, rechazadas: 0, sinConexion: true };
    }
    throw e;
  }
  const porId = new Map(resultados.map((r) => [r.client_uuid, r]));
  let enviadas = 0;
  let rechazadas = 0;
  // se relee por si se agregó otra checada mientras se enviaba
  const nueva = almacen.leer().flatMap((c): ChecadaLocal[] => {
    const r = porId.get(c.client_uuid);
    if (!r) return [c];
    if (r.estado === 'RECHAZADA') {
      rechazadas++;
      return [{ ...c, estado: 'RECHAZADA', motivo: r.motivo }];
    }
    enviadas++;
    return [];
  });
  almacen.guardar(nueva);
  return { enviadas, rechazadas, sinConexion: false };
}
