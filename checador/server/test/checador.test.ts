import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { cliente, diaLocal, haceMin, prepararApp } from './ayuda.js';

// Recorrido completo sobre la base con server/db/seed.sql (P3 + 4 empresas).
// Los casos son secuenciales: cada uno parte de lo que dejó el anterior.
const P3 = '00000000-0000-4000-8000-0000000000a1';
const E2 = '00000000-0000-4000-8000-0000000000a2';
const SOFIA = '00000000-0000-4000-8000-0000000000d3';
const JORGE = '00000000-0000-4000-8000-0000000000d6';
const CENTRO_CEN = '00000000-0000-4000-8000-0000000000c1';
const CERCA = { lat: 20.5889, lng: -100.3898, precision_m: 12 };
const LEJOS = { lat: 20.6, lng: -100.3899, precision_m: 12 };

let app: FastifyInstance;
let api: ReturnType<typeof cliente>;
const t: Record<string, string> = {};

before(async () => {
  app = await prepararApp();
  api = cliente(app);
  for (const u of ['dueno@grupo.mx', 'rh@p3.mx', 'supervisor@p3.mx', 'ana@p3.mx', 'diego@p3.mx', 'rh@e2.mx']) {
    t[u] = await api.entrar(u);
  }
});
after(() => app.close());

describe('sesión y empresas', () => {
  it('contraseña incorrecta: 401 sin decir si el correo existe', async () => {
    const r = await api.pedir('POST', '/api/sesion', { body: { email: 'ana@p3.mx', password: 'mala' } });
    assert.equal(r.status, 401);
    assert.equal(r.body.mensaje, 'Correo o contraseña incorrectos');
    const r2 = await api.pedir('POST', '/api/sesion', { body: { email: 'nadie@p3.mx', password: 'mala' } });
    assert.equal(r2.body.mensaje, 'Correo o contraseña incorrectos');
  });

  it('el dueño ve sus 5 empresas y cambia a P3 sin volver a entrar', async () => {
    const r = await api.pedir('GET', '/api/sesion', { token: t['dueno@grupo.mx'] });
    assert.deepEqual(r.body.empresas.map((e: { clave: string }) => e.clave), ['E2', 'E3', 'E4', 'E5', 'P3']);
    assert.equal(r.body.rol, 'ADMIN');
    const c = await api.pedir('POST', '/api/sesion/empresa', { token: t['dueno@grupo.mx'], body: { empresa_id: P3 } });
    assert.equal(c.status, 200);
    assert.equal(c.body.empresa.clave, 'P3');
    t.duenoP3 = c.body.token;
  });

  it('no puede cambiar a una empresa donde no tiene acceso', async () => {
    const r = await api.pedir('POST', '/api/sesion/empresa', { token: t['rh@p3.mx'], body: { empresa_id: E2 } });
    assert.equal(r.status, 403);
  });

  it('la trabajadora entra ligada a su ficha', async () => {
    const r = await api.pedir('GET', '/api/sesion', { token: t['ana@p3.mx'] });
    assert.equal(r.body.rol, 'TRABAJADOR');
    assert.equal(r.body.trabajador.nombre, 'Ana López');
    assert.deepEqual(r.body.trabajador.modalidades, ['LUGAR_FIJO', 'MOVIL']);
  });

  it('sin token o con token alterado: 401', async () => {
    assert.equal((await api.pedir('GET', '/api/yo/dia')).status, 401);
    assert.equal((await api.pedir('GET', '/api/yo/dia', { token: t['ana@p3.mx'] + 'x' })).status, 401);
  });
});

describe('aislamiento entre empresas', () => {
  it('RH de E2 sólo ve a su gente', async () => {
    const r = await api.pedir('GET', '/api/equipo/tablero', { token: t['rh@e2.mx'] });
    assert.equal(r.body.empresa.clave, 'E2');
    assert.deepEqual(r.body.equipo.map((x: { nombre: string }) => x.nombre), ['Carmen Ríos', 'Pedro Lara']);
  });

  it('RH de E2 no puede tocar fichas de P3 aunque conozca el id', async () => {
    const r = await api.pedir('PATCH', `/api/trabajadores/${SOFIA}`, { token: t['rh@e2.mx'], body: { nombre: 'Hackeo' } });
    assert.equal(r.status, 404);
  });
});

describe('celular del trabajador', () => {
  it('mi día: ya entró; toca descanso o salida', async () => {
    const r = await api.pedir('GET', '/api/yo/dia', { token: t['ana@p3.mx'] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.siguientes, ['INICIO_DESCANSO', 'SALIDA']);
    assert.equal(r.body.bitacora.length, 1);
    assert.ok(r.body.minutos_hoy > 0);
    assert.equal(r.body.trabajador.centro, 'Sucursal Centro');
  });

  it('fuera de la geocerca se registra, pero queda marcada', async () => {
    const r = await api.pedir('POST', '/api/yo/checadas', {
      token: t['ana@p3.mx'], body: { tipo: 'INICIO_DESCANSO', modalidad: 'LUGAR_FIJO', ocurrido_en: haceMin(6), ...LEJOS },
    });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.incidencias, ['FUERA_DE_ZONA']);
    assert.ok(r.body.distancia_m > 1000);
  });

  it('doble toque: rechazado', async () => {
    const r = await api.pedir('POST', '/api/yo/checadas', {
      token: t['ana@p3.mx'], body: { tipo: 'INICIO_DESCANSO', modalidad: 'LUGAR_FIJO', ocurrido_en: haceMin(5), ...CERCA },
    });
    assert.equal(r.status, 422);
    assert.match(r.body.mensaje, /Ya se registró inicio descanso/);
  });

  it('modalidad no habilitada: rechazada', async () => {
    const r = await api.pedir('POST', '/api/yo/checadas', { token: t['ana@p3.mx'], body: { tipo: 'FIN_DESCANSO', modalidad: 'DESDE_CASA' } });
    assert.equal(r.status, 422);
    assert.match(r.body.mensaje, /no tiene habilitado checar en modalidad desde casa/);
  });

  it('sin señal: el lote se aplica en orden y reenviarlo no duplica', async () => {
    const lote = { checadas: [
      { client_uuid: randomUUID(), tipo: 'SALIDA', modalidad: 'LUGAR_FIJO', ocurrido_en: haceMin(2), ...CERCA },
      { client_uuid: randomUUID(), tipo: 'FIN_DESCANSO', modalidad: 'LUGAR_FIJO', ocurrido_en: haceMin(4), ...CERCA },
    ] };
    const r1 = await api.pedir('POST', '/api/yo/checadas/lote', { token: t['ana@p3.mx'], body: lote });
    assert.deepEqual(r1.body.resultados.map((r: { estado: string }) => r.estado), ['ACEPTADA', 'ACEPTADA']);
    const r2 = await api.pedir('POST', '/api/yo/checadas/lote', { token: t['ana@p3.mx'], body: lote });
    assert.deepEqual(r2.body.resultados.map((r: { estado: string }) => r.estado), ['DUPLICADA', 'DUPLICADA']);
    const dia = await api.pedir('GET', '/api/yo/dia', { token: t['ana@p3.mx'] });
    assert.deepEqual(dia.body.siguientes, ['ENTRADA']);
  });

  it('hora en el futuro (reloj adelantado): rechazada', async () => {
    const r = await api.pedir('POST', '/api/yo/checadas', {
      token: t['diego@p3.mx'], body: { tipo: 'INICIO_DESCANSO', modalidad: 'DESDE_CASA', ocurrido_en: haceMin(-30) },
    });
    assert.equal(r.status, 422);
    assert.match(r.body.mensaje, /futuro/);
  });

  it('una cuenta sin ficha de trabajador no checa', async () => {
    const r = await api.pedir('POST', '/api/yo/checadas', { token: t['rh@p3.mx'], body: { tipo: 'ENTRADA', modalidad: 'MOVIL' } });
    assert.equal(r.status, 403);
  });
});

describe('kiosco', () => {
  it('sin activar o con código inválido no funciona', async () => {
    assert.equal((await api.pedir('GET', '/api/kiosco')).status, 401);
    assert.equal((await api.pedir('GET', '/api/kiosco', { kiosco: 'codigo-falso-123' })).status, 401);
    const k = await api.pedir('GET', '/api/kiosco', { kiosco: 'demo-kiosco-norte' });
    assert.deepEqual(k.body, { empresa: 'P3', clave: 'P3', centro: 'Almacén Norte' });
  });

  it('número + PIN; el tipo se deduce (Marco ya entró → descanso)', async () => {
    const mal = await api.pedir('POST', '/api/kiosco/checar', { kiosco: 'demo-kiosco-norte', body: { numero: '014', pin: '9999' } });
    assert.equal(mal.status, 401);
    const r = await api.pedir('POST', '/api/kiosco/checar', { kiosco: 'demo-kiosco-norte', body: { numero: '014', pin: '1234' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.trabajador, 'Marco Salas');
    assert.equal(r.body.tipo, 'INICIO_DESCANSO');
    assert.deepEqual(r.body.siguientes, ['FIN_DESCANSO']);
  });

  it('5 PIN erróneos bloquean; RH desbloquea', async () => {
    for (let i = 0; i < 5; i++) {
      await api.pedir('POST', '/api/kiosco/checar', { kiosco: 'demo-kiosco-centro', body: { numero: '016', pin: '0000' } });
    }
    const r = await api.pedir('POST', '/api/kiosco/checar', { kiosco: 'demo-kiosco-centro', body: { numero: '016', pin: '3456' } });
    assert.equal(r.status, 401);
    assert.match(r.body.mensaje, /Demasiados intentos/);
    const lista = await api.pedir('GET', '/api/trabajadores', { token: t['rh@p3.mx'] });
    assert.equal(lista.body.find((x: { numero: string }) => x.numero === '016').bloqueado, true);
    await api.pedir('PATCH', `/api/trabajadores/${JORGE}`, { token: t['rh@p3.mx'], body: { desbloquear: true } });
    const ok = await api.pedir('POST', '/api/kiosco/checar', { kiosco: 'demo-kiosco-centro', body: { numero: '016', pin: '3456' } });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.tipo, 'ENTRADA');
  });

  it('el kiosco de otra empresa no encuentra trabajadores de P3', async () => {
    const r = await api.pedir('POST', '/api/kiosco/checar', { kiosco: 'demo-kiosco-e2', body: { numero: '014', pin: '1234' } });
    assert.equal(r.status, 401);
  });

  it('RH activa y desactiva una tableta; el supervisor no puede', async () => {
    const sup = await api.pedir('POST', '/api/kiosco/activar', {
      token: t['supervisor@p3.mx'], body: { centro_id: CENTRO_CEN, nombre: 'Tableta 2' } });
    assert.equal(sup.status, 403);
    const a = await api.pedir('POST', '/api/kiosco/activar', { token: t['rh@p3.mx'], body: { centro_id: CENTRO_CEN, nombre: 'Tableta 2' } });
    assert.equal(a.status, 201);
    assert.equal((await api.pedir('GET', '/api/kiosco', { kiosco: a.body.token })).body.centro, 'Sucursal Centro');
    await api.pedir('POST', `/api/dispositivos/${a.body.id}/revocar`, { token: t['rh@p3.mx'] });
    assert.equal((await api.pedir('GET', '/api/kiosco', { kiosco: a.body.token })).status, 401);
  });
});

describe('supervisión', () => {
  it('tablero en vivo de P3', async () => {
    const r = await api.pedir('GET', '/api/equipo/tablero', { token: t['supervisor@p3.mx'] });
    assert.equal(r.status, 200);
    assert.equal(r.body.es_hoy, true);
    assert.equal(r.body.resumen.total, 6);
    const ana = r.body.equipo.find((x: { numero: string }) => x.numero === '001');
    assert.equal(ana.estado, 'SALIO');
    assert.ok(ana.alertas.includes('FUERA_DE_ZONA'));
    const marco = r.body.equipo.find((x: { numero: string }) => x.numero === '014');
    assert.equal(marco.estado, 'EN_DESCANSO');
    assert.ok(r.body.incidencias.some((i: { trabajador: string }) => i.trabajador === 'Diego Ruiz'));
  });

  it('el trabajador no ve el tablero; el supervisor no corrige', async () => {
    assert.equal((await api.pedir('GET', '/api/equipo/tablero', { token: t['ana@p3.mx'] })).status, 403);
    const r = await api.pedir('POST', '/api/equipo/correcciones', { token: t['supervisor@p3.mx'], body: {
      trabajador_id: SOFIA, tipo: 'INICIO_DESCANSO', ocurrido_en: haceMin(3), motivo: 'Salió a comer' } });
    assert.equal(r.status, 403);
  });

  it('corrección con motivo y anulación; otra empresa no puede anular', async () => {
    const corta = await api.pedir('POST', '/api/equipo/correcciones', { token: t['rh@p3.mx'], body: {
      trabajador_id: SOFIA, tipo: 'INICIO_DESCANSO', ocurrido_en: haceMin(3), motivo: 'x' } });
    assert.equal(corta.status, 400);
    const c = await api.pedir('POST', '/api/equipo/correcciones', { token: t['rh@p3.mx'], body: {
      trabajador_id: SOFIA, tipo: 'INICIO_DESCANSO', ocurrido_en: haceMin(3), motivo: 'Visita a cliente, sin batería' } });
    assert.equal(c.status, 201);
    assert.equal((await api.pedir('POST', `/api/equipo/checadas/${c.body.id}/anular`, {
      token: t['rh@e2.mx'], body: { motivo: 'Intento ajeno' } })).status, 404);
    assert.equal((await api.pedir('POST', `/api/equipo/checadas/${c.body.id}/anular`, {
      token: t['rh@p3.mx'], body: { motivo: 'Capturada por error' } })).status, 200);
    assert.equal((await api.pedir('POST', `/api/equipo/checadas/${c.body.id}/anular`, {
      token: t['rh@p3.mx'], body: { motivo: 'Capturada por error' } })).status, 409);
    const b = await api.pedir('GET', `/api/equipo/bitacora?trabajador_id=${SOFIA}`, { token: t['rh@p3.mx'] });
    const anulada = b.body.find((x: { id: string }) => x.id === c.body.id);
    assert.equal(anulada.anulada, true);
    assert.equal(anulada.medio, 'SUPERVISOR');
  });

  it('no se corrige dentro de un periodo cerrado', async () => {
    const r = await api.pedir('POST', '/api/equipo/correcciones', { token: t['rh@p3.mx'], body: {
      trabajador_id: SOFIA, tipo: 'ENTRADA', ocurrido_en: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      motivo: 'Olvidó checar' } });
    assert.equal(r.status, 422);
    assert.match(r.body.mensaje, /cerrado/);
  });
});

describe('alta de trabajadores y accesos', () => {
  it('validaciones del alta', async () => {
    const sinPin = await api.pedir('POST', '/api/trabajadores', { token: t['rh@p3.mx'], body: {
      numero: '020', nombre: 'Luis Mora', modalidades: ['KIOSCO'] } });
    assert.equal(sinPin.status, 422);
    const dup = await api.pedir('POST', '/api/trabajadores', { token: t['rh@p3.mx'], body: {
      numero: '001', nombre: 'Otra Ana', modalidades: ['MOVIL'] } });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.mensaje, 'Ya existe un trabajador con ese número');
  });

  it('RH da de alta a un trabajador con cuenta para su celular', async () => {
    const tr = await api.pedir('POST', '/api/trabajadores', { token: t['rh@p3.mx'], body: {
      numero: '020', nombre: 'Luis Mora', puesto: 'Chofer', modalidades: ['MOVIL', 'KIOSCO'], pin: '4321', hora_entrada: '08:30' } });
    assert.equal(tr.status, 201);
    const sinPass = await api.pedir('POST', '/api/usuarios', { token: t['rh@p3.mx'], body: {
      email: 'luis@p3.mx', nombre: 'Luis Mora', rol: 'TRABAJADOR', trabajador_id: tr.body.id } });
    assert.equal(sinPass.status, 422);
    const u = await api.pedir('POST', '/api/usuarios', { token: t['rh@p3.mx'], body: {
      email: 'luis@p3.mx', nombre: 'Luis Mora', rol: 'TRABAJADOR', trabajador_id: tr.body.id, password: 'luis-2026!' } });
    assert.equal(u.status, 201);
    const tok = await api.entrar('luis@p3.mx', 'luis-2026!');
    const dia = await api.pedir('GET', '/api/yo/dia', { token: tok });
    assert.equal(dia.body.trabajador.nombre, 'Luis Mora');
  });

  it('sólo un ADMIN da roles ADMIN o RH', async () => {
    const r = await api.pedir('POST', '/api/usuarios', { token: t['rh@p3.mx'], body: {
      email: 'otro@p3.mx', nombre: 'Otro', rol: 'RH', password: 'contraseña-larga' } });
    assert.equal(r.status, 403);
  });

  it('una cuenta existente de otra empresa se reutiliza; quitar el acceso corta la sesión', async () => {
    const r = await api.pedir('POST', '/api/usuarios', { token: t.duenoP3, body: {
      email: 'rh@e2.mx', nombre: 'RH Empresa 2', rol: 'SUPERVISOR' } });
    assert.equal(r.status, 201);
    const s = await api.pedir('GET', '/api/sesion', { token: t['rh@e2.mx'] });
    assert.deepEqual(s.body.empresas.map((e: { clave: string }) => e.clave), ['E2', 'P3']);
    const p3 = await api.pedir('POST', '/api/sesion/empresa', { token: t['rh@e2.mx'], body: { empresa_id: P3 } });
    assert.equal((await api.pedir('GET', '/api/equipo/tablero', { token: p3.body.token })).status, 200);
    await api.pedir('PATCH', `/api/usuarios/${r.body.cuenta_id}`, { token: t.duenoP3, body: { activa: false } });
    assert.equal((await api.pedir('GET', '/api/equipo/tablero', { token: p3.body.token })).status, 401);
  });
});

describe('periodos', () => {
  it('el periodo cerrado de la semana pasada: Ana ya aceptó', async () => {
    const r = await api.pedir('GET', '/api/yo/periodos', { token: t['ana@p3.mx'] });
    assert.equal(r.body[0].respuesta, 'ACEPTADO');
    assert.ok(r.body[0].horas > 30);
  });

  it('Diego objeta (con comentario) una sola vez', async () => {
    const [p] = (await api.pedir('GET', '/api/yo/periodos', { token: t['diego@p3.mx'] })).body;
    const url = `/api/yo/periodos/${p.id}/respuesta`;
    assert.equal((await api.pedir('POST', url, { token: t['diego@p3.mx'], body: { acepta: false } })).status, 400);
    assert.equal((await api.pedir('POST', url, { token: t['diego@p3.mx'], body: {
      acepta: false, comentario: 'El martes sí estaba en la oficina' } })).status, 200);
    assert.equal((await api.pedir('POST', url, { token: t['diego@p3.mx'], body: { acepta: true } })).status, 422);
  });

  it('RH: listado, detalle y CSV para nómina', async () => {
    const l = await api.pedir('GET', '/api/periodos', { token: t['rh@p3.mx'] });
    assert.equal(l.body[0].estado, 'CERRADO');
    assert.equal(l.body[0].aceptados, 1);
    assert.equal(l.body[0].objetados, 2);
    const d = await api.pedir('GET', `/api/periodos/${l.body[0].id}`, { token: t['rh@p3.mx'] });
    assert.equal(d.body.trabajadores.length, 6);
    const csv = await api.pedir('GET', `/api/periodos/${l.body[0].id}/csv`, { token: t['rh@p3.mx'] });
    assert.match(String(csv.headers['content-type']), /text\/csv/);
    assert.match(csv.texto, /numero,nombre,horas/);
    assert.match(csv.texto, /001,Ana López,[\d.]+,\d,1,0,0,0,ACEPTADO/);
  });

  it('no se traslapa ni se cierra antes de terminar', async () => {
    const tras = await api.pedir('POST', '/api/periodos', { token: t['rh@p3.mx'], body: {
      nombre: 'Traslape', inicio: diaLocal(-2), fin: diaLocal(5) } });
    assert.equal(tras.status, 422);
    const p = await api.pedir('POST', '/api/periodos', { token: t['rh@p3.mx'], body: {
      nombre: 'Quincena actual', inicio: diaLocal(0), fin: diaLocal(14) } });
    assert.equal(p.status, 201);
    const c = await api.pedir('POST', `/api/periodos/${p.body.id}/cerrar`, { token: t['rh@p3.mx'] });
    assert.equal(c.status, 422);
    assert.match(c.body.mensaje, /aún no termina/);
  });
});

describe('vista del grupo', () => {
  it('el dueño ve una fila por empresa', async () => {
    const r = await api.pedir('GET', '/api/grupo', { token: t['dueno@grupo.mx'] });
    assert.deepEqual(r.body.empresas.map((e: { clave: string }) => e.clave), ['E2', 'E3', 'E4', 'E5', 'P3']);
    const p3 = r.body.empresas.find((e: { clave: string }) => e.clave === 'P3');
    assert.equal(p3.total, 7);
    assert.ok(p3.requieren_atencion >= 2);
  });

  it('un trabajador no ve el consolidado', async () => {
    const r = await api.pedir('GET', '/api/grupo', { token: t['ana@p3.mx'] });
    assert.deepEqual(r.body.empresas, []);
  });
});
