import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularSemaforo } from './semaforo';

// Mismos casos que packages/db/demo_flujo.sql (losa: 105 m3 × $2,000)
const base = {
  cantidad_vigente: 105, importe_vigente: 210000, precio_vigente: 2000,
  cant_disponible: 105, imp_disponible: 210000, pct_avance_fisico: 0, cantidad: 50, precio: 2000,
};

test('VERDE: 50 m3 sobre 105 sin consumo previo', () => {
  assert.equal(calcularSemaforo(base).resultado, 'VERDE');
});

test('ROJO: 70 m3 más cuando ya se ejercieron 50 a $2,100', () => {
  const r = calcularSemaforo({ ...base, cant_disponible: 55, imp_disponible: 105000, cantidad: 70 });
  assert.equal(r.resultado, 'ROJO');
  assert.equal(r.pct_consumo_cantidad, 114.29);
});

test('AMARILLO por consumo anticipado tras ampliar a 126 m3', () => {
  const r = calcularSemaforo({
    ...base, cantidad_vigente: 126, importe_vigente: 252000, cant_disponible: 76, imp_disponible: 147000, cantidad: 70,
  });
  assert.equal(r.resultado, 'AMARILLO');
  assert.match(r.motivos.join(' '), /Consumo anticipado/);
});

test('AMARILLO por precio 10% arriba', () => {
  const r = calcularSemaforo({ ...base, cantidad: 10, precio: 2200 });
  assert.equal(r.resultado, 'AMARILLO');
});

test('sin importes visibles (cabo) sólo evalúa volumen', () => {
  const r = calcularSemaforo({ ...base, importe_vigente: 0, imp_disponible: 0, precio_vigente: 0, precio: 0, cantidad: 40 });
  assert.equal(r.resultado, 'VERDE');
  assert.equal(r.pct_consumo_importe, 0);
});
