// Reglas y textos de la jornada que la app necesita sin conexión.
// siguientes() es la misma tabla que checador.siguientes() en la base.
import type { Alerta, EstadoAsistencia, Modalidad, TipoChecada } from '../../server/src/tipos';

export function siguientes(ultimo: TipoChecada | null): TipoChecada[] {
  switch (ultimo) {
    case 'ENTRADA':
    case 'FIN_DESCANSO':
      return ['INICIO_DESCANSO', 'SALIDA'];
    case 'INICIO_DESCANSO':
      return ['FIN_DESCANSO'];
    default:
      return ['ENTRADA'];
  }
}

export const BOTON: Record<TipoChecada, string> = {
  ENTRADA: 'Registrar entrada',
  INICIO_DESCANSO: 'Salir a descanso',
  FIN_DESCANSO: 'Regresar de descanso',
  SALIDA: 'Registrar salida',
};
export const CHECADA: Record<TipoChecada, string> = {
  ENTRADA: 'Entrada',
  INICIO_DESCANSO: 'Descanso',
  FIN_DESCANSO: 'Regreso',
  SALIDA: 'Salida',
};
export const REGISTRADA: Record<TipoChecada, string> = {
  ENTRADA: 'Entrada registrada',
  INICIO_DESCANSO: 'Descanso registrado',
  FIN_DESCANSO: 'Regreso registrado',
  SALIDA: 'Salida registrada',
};
export const MODALIDAD: Record<Modalidad, string> = {
  LUGAR_FIJO: 'Lugar fijo',
  DESDE_CASA: 'Desde casa',
  MOVIL: 'Móvil',
  KIOSCO: 'Kiosco',
};
export const ALERTA: Record<Alerta, string> = {
  FUERA_DE_ZONA: 'Fuera de zona',
  SIN_UBICACION: 'Sin ubicación',
  SECUENCIA: 'Fuera de secuencia',
  RETARDO: 'Retardo',
  NO_HA_LLEGADO: 'No ha llegado',
};
export const ESTADO: Record<EstadoAsistencia, string> = {
  TRABAJANDO: 'Trabajando',
  EN_DESCANSO: 'En descanso',
  SALIO: 'Salió',
  SIN_REGISTRO: 'Sin registro',
};

/** Saludo según la hora local. */
export function saludo(fecha = new Date(), zona = 'America/Mexico_City') {
  const h = Number(new Intl.DateTimeFormat('es-MX', { hour: 'numeric', hourCycle: 'h23', timeZone: zona }).format(fecha));
  return h < 12 ? 'Buen día' : h < 19 ? 'Buena tarde' : 'Buena noche';
}

export const hora = (iso: string | Date | null | undefined, zona = 'America/Mexico_City') =>
  iso ? new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zona }).format(new Date(iso)) : '—';

export const horas = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
};

export const fechaLarga = (ymd: string) => {
  const [a, m, d] = ymd.split('-').map(Number);
  const t = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(a, m - 1, d)));
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export const hoyEn = (zona = 'America/Mexico_City', dias = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(new Date(Date.now() + dias * 86_400_000));

/** Quincena que contiene la fecha (1–15 o 16–fin de mes). */
export function quincena(ymd: string): { nombre: string; inicio: string; fin: string } {
  const [a, m, d] = ymd.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const [i, f] = d <= 15 ? [1, 15] : [16, ultimo];
  const mes = new Intl.DateTimeFormat('es-MX', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(a, m - 1, 1)));
  const dd = (n: number) => `${a}-${String(m).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
  return { nombre: `Quincena del ${i} al ${f} de ${mes}`, inicio: dd(i), fin: dd(f) };
}

/** Distancia aproximada en metros (para avisar en el celular antes de checar). */
export function distancia(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (x: number) => (x * Math.PI) / 180;
  const s = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
}

/** Fecha 'YYYY-MM-DD' + hora 'HH:MM' en la zona de la empresa → instante ISO (para correcciones de RH). */
export function instanteEnZona(ymd: string, hhmm: string, zona = 'America/Mexico_City'): string {
  const [a, m, d] = ymd.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const supuesto = Date.UTC(a, m - 1, d, h, mi);
  const desfase = (t: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zona, hourCycle: 'h23', year: 'numeric',
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t;
  };
  const t1 = supuesto - desfase(supuesto);
  return new Date(supuesto - desfase(t1)).toISOString();
}
