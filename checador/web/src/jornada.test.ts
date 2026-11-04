import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distancia, quincena, siguientes } from './jornada';

test('secuencia de la jornada (igual que la base)', () => {
  assert.deepEqual(siguientes(null), ['ENTRADA']);
  assert.deepEqual(siguientes('ENTRADA'), ['INICIO_DESCANSO', 'SALIDA']);
  assert.deepEqual(siguientes('INICIO_DESCANSO'), ['FIN_DESCANSO']);
  assert.deepEqual(siguientes('FIN_DESCANSO'), ['INICIO_DESCANSO', 'SALIDA']);
  assert.deepEqual(siguientes('SALIDA'), ['ENTRADA']);
});

test('quincenas', () => {
  assert.deepEqual(quincena('2026-11-04'), { nombre: 'Quincena del 1 al 15 de noviembre', inicio: '2026-11-01', fin: '2026-11-15' });
  assert.equal(quincena('2026-02-20').fin, '2026-02-28');
  assert.equal(quincena('2028-02-20').fin, '2028-02-29');
});

test('distancia: ~1.2 km entre dos puntos conocidos', () => {
  const d = distancia({ lat: 20.5888, lng: -100.3899 }, { lat: 20.6, lng: -100.3899 });
  assert.ok(d > 1200 && d < 1300, String(d));
});

test('hora local de la empresa → instante', async () => {
  const { instanteEnZona } = await import('./jornada');
  assert.equal(instanteEnZona('2026-11-04', '09:00', 'America/Mexico_City'), '2026-11-04T15:00:00.000Z');
  assert.equal(instanteEnZona('2026-07-04', '09:00', 'America/Tijuana'), '2026-07-04T16:00:00.000Z');
});
