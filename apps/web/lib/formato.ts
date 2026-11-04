const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });

export const dinero = (v: number | null | undefined) => (v == null ? '—' : mxn.format(v));
export const numero = (v: number | null | undefined) => (v == null ? '—' : num.format(v));
export const pct = (v: number | null | undefined) => (v == null ? '—' : `${num.format(v)} %`);
export const indice = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2));

// Las empresas del grupo operan en la zona centro (oc.empresas.zona_horaria)
const hhmm = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' });
export const hora = (iso: string | null | undefined) => (iso ? hhmm.format(new Date(iso)) : '—');
