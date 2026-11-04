const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });

export const dinero = (v: number | null | undefined) => (v == null ? '—' : mxn.format(v));
export const numero = (v: number | null | undefined) => (v == null ? '—' : num.format(v));
export const pct = (v: number | null | undefined) => (v == null ? '—' : `${num.format(v)} %`);
export const indice = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2));
