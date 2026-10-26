// Pre-cálculo del semáforo en el cliente (app de campo sin señal).
// Replica la lógica de oc.fn_validar_linea_requisicion con los saldos de la
// última sincronización; el servidor siempre recalcula y decide.
import type { Semaforo } from './index';

export interface Tolerancias {
  tol_amarillo_pct: number;
  tol_rojo_pct: number;
  tol_precio_pct: number;
  tol_anticipo_pts: number;
}

export const TOLERANCIAS_DEFECTO: Tolerancias = {
  tol_amarillo_pct: 0,
  tol_rojo_pct: 5,
  tol_precio_pct: 8,
  tol_anticipo_pts: 30,
};

export interface EntradaSemaforo {
  cantidad_vigente: number;
  importe_vigente: number;
  precio_vigente: number;
  cant_disponible: number;
  imp_disponible: number;
  pct_avance_fisico: number;
  cantidad: number;
  precio: number;
}

export function calcularSemaforo(
  e: EntradaSemaforo,
  tol: Tolerancias = TOLERANCIAS_DEFECTO,
): { resultado: Semaforo; motivos: string[]; pct_consumo_cantidad: number; pct_consumo_importe: number } {
  const importe = Math.round(e.cantidad * e.precio * 100) / 100;
  const pctCant = e.cantidad_vigente > 0
    ? (100 * (e.cantidad_vigente - e.cant_disponible + e.cantidad)) / e.cantidad_vigente : 999;
  // importe_vigente = 0 con precio 0: el usuario no ve importes (cabo); sólo se evalúa volumen
  const pctImp = e.importe_vigente > 0
    ? (100 * (e.importe_vigente - e.imp_disponible + importe)) / e.importe_vigente
    : importe === 0 ? 0 : 999;
  const pctPrecio = e.precio_vigente > 0 ? (100 * (e.precio - e.precio_vigente)) / e.precio_vigente : 0;

  const motivos: string[] = [];
  let resultado: Semaforo = 'VERDE';
  const peor = Math.max(pctCant, pctImp);
  if (peor > 100 + tol.tol_rojo_pct) {
    resultado = 'ROJO';
    motivos.push(`Excede presupuesto: ${pctCant.toFixed(1)}% de volumen, ${pctImp.toFixed(1)}% de importe`);
  } else if (peor > 100 + tol.tol_amarillo_pct) {
    resultado = 'AMARILLO';
    motivos.push(`Sobregiro dentro de tolerancia: ${peor.toFixed(1)}%`);
  }
  if (pctPrecio > tol.tol_precio_pct) {
    if (resultado === 'VERDE') resultado = 'AMARILLO';
    motivos.push(`Precio ${pctPrecio.toFixed(1)}% arriba del presupuesto`);
  }
  if (pctCant - e.pct_avance_fisico > tol.tol_anticipo_pts && pctCant > 50) {
    if (resultado === 'VERDE') resultado = 'AMARILLO';
    motivos.push(`Consumo anticipado: material al ${pctCant.toFixed(1)}% con avance físico de ${e.pct_avance_fisico}%`);
  }
  return {
    resultado,
    motivos,
    pct_consumo_cantidad: Math.round(pctCant * 100) / 100,
    pct_consumo_importe: Math.round(pctImp * 100) / 100,
  };
}
