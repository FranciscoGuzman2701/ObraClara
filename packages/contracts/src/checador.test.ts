import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CrearPeriodoInput, KioscoChecadaInput, RespuestaPeriodoInput, siguientesChecada } from './checador';

// Mismas transiciones que oc.siguientes_checada() (packages/db/demo_checador.sql)
test('secuencia de la jornada', () => {
  assert.deepEqual(siguientesChecada(null), ['ENTRADA']);
  assert.deepEqual(siguientesChecada('ENTRADA'), ['INICIO_DESCANSO', 'SALIDA']);
  assert.deepEqual(siguientesChecada('INICIO_DESCANSO'), ['FIN_DESCANSO']);
  assert.deepEqual(siguientesChecada('FIN_DESCANSO'), ['INICIO_DESCANSO', 'SALIDA']);
  assert.deepEqual(siguientesChecada('SALIDA'), ['ENTRADA']);
});

test('kiosco: PIN numérico de 4 a 8 dígitos', () => {
  assert.equal(KioscoChecadaInput.safeParse({ numero: '014', pin: '1234' }).success, true);
  assert.equal(KioscoChecadaInput.safeParse({ numero: '014', pin: '12a4' }).success, false);
  assert.equal(KioscoChecadaInput.safeParse({ numero: '014', pin: '123' }).success, false);
});

test('objetar un periodo exige explicar por qué', () => {
  assert.equal(RespuestaPeriodoInput.safeParse({ acepta: true }).success, true);
  assert.equal(RespuestaPeriodoInput.safeParse({ acepta: false }).success, false);
  assert.equal(RespuestaPeriodoInput.safeParse({ acepta: false, comentario: 'Faltan mis horas del sábado' }).success, true);
});

test('periodo con fechas en orden', () => {
  assert.equal(CrearPeriodoInput.safeParse({ nombre: 'Quincena 1', inicio: '2026-11-01', fin: '2026-11-15' }).success, true);
  assert.equal(CrearPeriodoInput.safeParse({ nombre: 'Quincena 1', inicio: '2026-11-15', fin: '2026-11-01' }).success, false);
});
