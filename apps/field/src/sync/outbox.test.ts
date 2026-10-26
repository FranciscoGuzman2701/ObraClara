import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ComandoSync, ResultadoComando } from '@obraclara/contracts';
import { ComandoLocal, FotoLocal, OutboxStore, SinConexion, sincronizar, Transporte } from './outbox';

const OBRA = '00000000-0000-0000-0000-0000000000b1';

class StoreMemoria implements OutboxStore {
  comandos = new Map<string, ComandoLocal>();
  fotos = new Map<string, FotoLocal>();

  agregar(c: ComandoSync, fotos = 0) {
    this.comandos.set(c.client_uuid, { comando: c, estado: 'PENDIENTE', id_servidor: null, motivo: null, intentos: 0 });
    for (let i = 0; i < fotos; i++) {
      const id = `${c.client_uuid}-f${i}`;
      this.fotos.set(id, {
        id, comando_uuid: c.client_uuid, entidad_tipo: 'AVANCE', uri: `file:///${id}.jpg`, mime: 'image/jpeg',
        bytes: 1000, sha256: 'b'.repeat(64), tomada_en: new Date().toISOString(), lat: 20.5, lng: -100.4,
        estado: 'PENDIENTE', error: null, intentos: 0,
      });
    }
  }
  async comandosPendientes() { return [...this.comandos.values()].filter((c) => c.estado === 'PENDIENTE'); }
  async comando(id: string) { return this.comandos.get(id) ?? null; }
  async actualizarComando(id: string, cambios: Partial<ComandoLocal>) { Object.assign(this.comandos.get(id)!, cambios); }
  async fotosPendientes() { return [...this.fotos.values()].filter((f) => f.estado === 'PENDIENTE'); }
  async actualizarFoto(id: string, cambios: Partial<FotoLocal>) { Object.assign(this.fotos.get(id)!, cambios); }
}

const avance = (n: number): ComandoSync => ({
  tipo: 'AVANCE_CREAR', client_uuid: `00000000-0000-4000-8000-00000000000${n}`, obra_id: OBRA,
  creado_en: new Date().toISOString(),
  payload: { concepto_id: '00000000-0000-0000-0000-000000000401', cantidad: 10, fecha: '2026-10-26' },
});

function transporte(opts: { rechazar?: string[]; caerEnPush?: boolean; caerEnSubida?: boolean } = {}) {
  const llamadas = { push: 0, subidas: [] as string[], confirmados: [] as string[] };
  const t: Transporte = {
    async push(cmds) {
      llamadas.push++;
      if (opts.caerEnPush) throw new SinConexion('sin señal');
      return cmds.map((c): ResultadoComando => (opts.rechazar?.includes(c.client_uuid)
        ? { client_uuid: c.client_uuid, estado: 'RECHAZADO', motivo: 'Concepto inexistente' }
        : { client_uuid: c.client_uuid, estado: 'ACEPTADO', id: `srv-${c.client_uuid.slice(-1)}` }));
    },
    async prefirmar() { return { archivo_id: 'arch', upload_url: 'https://s3/put', headers: {} }; },
    async subir(_url, uri) {
      if (opts.caerEnSubida) throw new SinConexion('sin señal');
      llamadas.subidas.push(uri);
    },
    async confirmar(input) { llamadas.confirmados.push(input.entidad_id); },
  };
  return { t, llamadas };
}

test('envía comandos, sube fotos y las liga al id del servidor', async () => {
  const s = new StoreMemoria();
  s.agregar(avance(1), 2);
  const { t, llamadas } = transporte();
  const r = await sincronizar(s, t);
  assert.deepEqual(r, { enviados: 1, aceptados: 1, rechazados: 0, fotosSubidas: 2, fotosDescartadas: 0, sinConexion: false });
  assert.deepEqual(llamadas.confirmados, ['srv-1', 'srv-1']);
  assert.equal((await s.comando(avance(1).client_uuid))!.estado, 'ACEPTADO');
});

test('comando rechazado: guarda el motivo y descarta sus fotos', async () => {
  const s = new StoreMemoria();
  s.agregar(avance(1), 1);
  s.agregar(avance(2), 1);
  const { t, llamadas } = transporte({ rechazar: [avance(2).client_uuid] });
  const r = await sincronizar(s, t);
  assert.equal(r.rechazados, 1);
  assert.equal(r.fotosDescartadas, 1);
  assert.equal((await s.comando(avance(2).client_uuid))!.motivo, 'Concepto inexistente');
  assert.equal(llamadas.subidas.length, 1);
});

test('sin señal: nada se pierde y el reintento completa el trabajo', async () => {
  const s = new StoreMemoria();
  s.agregar(avance(1), 1);
  const caido = await sincronizar(s, transporte({ caerEnPush: true }).t);
  assert.equal(caido.sinConexion, true);
  assert.equal((await s.comandosPendientes()).length, 1);
  assert.equal((await s.comando(avance(1).client_uuid))!.intentos, 1);

  // se recupera la red para el push, pero se cae durante la subida de la foto
  const r2 = await sincronizar(s, transporte({ caerEnSubida: true }).t);
  assert.equal(r2.sinConexion, true);
  assert.equal((await s.comandosPendientes()).length, 0);
  assert.equal((await s.fotosPendientes()).length, 1);

  const r3 = await sincronizar(s, transporte().t);
  assert.equal(r3.fotosSubidas, 1);
  assert.equal((await s.fotosPendientes()).length, 0);
});

test('envía en lotes', async () => {
  const s = new StoreMemoria();
  for (let i = 1; i <= 5; i++) s.agregar(avance(i));
  const { t, llamadas } = transporte();
  await sincronizar(s, t, { lote: 2 });
  assert.equal(llamadas.push, 3);
});
