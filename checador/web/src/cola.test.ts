import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enviarCola, type Almacen, type ChecadaLocal } from './cola';

const memoria = (inicial: ChecadaLocal[] = []): Almacen & { lista: ChecadaLocal[] } => ({
  lista: inicial,
  leer() { return structuredClone(this.lista); },
  guardar(l) { this.lista = l; },
});
const ch = (id: string, tipo: ChecadaLocal['tipo'] = 'ENTRADA'): ChecadaLocal => ({
  client_uuid: id, tipo, modalidad: 'MOVIL', ocurrido_en: new Date().toISOString(), estado: 'PENDIENTE',
});

test('sin conexión: nada se pierde', async () => {
  const a = memoria([ch('a'), ch('b', 'SALIDA')]);
  const r = await enviarCola(a, async () => { const e = new Error('Sin conexión'); e.name = 'SinConexion'; throw e; });
  assert.equal(r.sinConexion, true);
  assert.equal(a.lista.length, 2);
});

test('aceptadas y duplicadas salen de la cola; rechazadas se quedan con su motivo', async () => {
  const a = memoria([ch('a'), ch('b', 'SALIDA'), ch('c', 'SALIDA')]);
  const r = await enviarCola(a, async () => [
    { client_uuid: 'a', estado: 'ACEPTADA', id: '1' },
    { client_uuid: 'b', estado: 'DUPLICADA', id: '2' },
    { client_uuid: 'c', estado: 'RECHAZADA', motivo: 'Ya se registró salida a las 18:00' },
  ]);
  assert.deepEqual(r, { enviadas: 2, rechazadas: 1, sinConexion: false });
  assert.deepEqual(a.lista.map((c) => [c.client_uuid, c.estado, c.motivo]),
    [['c', 'RECHAZADA', 'Ya se registró salida a las 18:00']]);
});

test('no reenvía las ya rechazadas', async () => {
  const a = memoria([{ ...ch('x'), estado: 'RECHAZADA', motivo: 'm' }]);
  let llamadas = 0;
  await enviarCola(a, async () => { llamadas++; return []; });
  assert.equal(llamadas, 0);
});
