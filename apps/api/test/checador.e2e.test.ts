import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { api, crearApp, login, StorageFalso } from './helpers';

// Checador multi-empresa sobre la base con seed_dev.sql (P3 + E2…E5).
// Los casos son secuenciales: cada uno parte del estado que dejó el anterior.
const P3 = '00000000-0000-0000-00c0-000000000001';
const E2 = '00000000-0000-0000-00c0-000000000002';
const DEMO = '00000000-0000-0000-0000-0000000000e1';
const SOFIA = '00000000-0000-0000-00c0-000000000303';
const CENTRO = { lat: 20.5888, lng: -100.3899 };

const fechaLocal = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(d);
const haceMin = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const diaLocal = (dias: number) => fechaLocal(new Date(Date.now() + dias * 86_400_000));

describe('Checador multi-empresa', () => {
  let app: INestApplication;
  const t: Record<string, string> = {};

  beforeAll(async () => {
    app = await crearApp(new StorageFalso());
    for (const u of ['rh@p3.mx', 'kiosco@p3.mx', 'ana@p3.mx', 'rh@e2.mx', 'dueno@grupo.mx']) t[u] = await login(app, u);
  });
  afterAll(() => app.close());

  describe('una persona, cinco empresas', () => {
    it('el dueño ve sus 5 empresas y cambia de una a otra', async () => {
      const r = await api(app, t['dueno@grupo.mx']).get('/v1/auth/empresas').expect(200);
      expect(r.body.map((e: { clave: string }) => e.clave)).toEqual(['E2', 'E3', 'E4', 'E5', 'P3']);
      expect(r.body.filter((e: { actual: boolean }) => e.actual)).toHaveLength(1);

      const cambio = await api(app, t['dueno@grupo.mx']).post('/v1/auth/cambiar-empresa', { empresa_id: P3 }).expect(201);
      expect(cambio.body.usuario.empresa_id).toBe(P3);
      t.duenoP3 = cambio.body.token;
      const yo = await api(app, t.duenoP3).get('/v1/auth/yo').expect(200);
      expect(yo.body.empresa_id).toBe(P3);
    });

    it('no puede entrar a una empresa donde no tiene usuario', async () => {
      await api(app, t['dueno@grupo.mx']).post('/v1/auth/cambiar-empresa', { empresa_id: DEMO }).expect(403);
      await api(app, t['ana@p3.mx']).post('/v1/auth/cambiar-empresa', { empresa_id: E2 }).expect(403);
    });
  });

  describe('celular del trabajador', () => {
    it('entrada dentro de la geocerca, sin incidencias', async () => {
      const r = await api(app, t['ana@p3.mx']).post('/v1/checador/checadas', {
        tipo: 'ENTRADA', modalidad: 'LUGAR_FIJO', ocurrido_en: haceMin(16), ...CENTRO, precision_m: 12,
      }).expect(201);
      expect(r.body).toMatchObject({ trabajador: 'Ana López', tipo: 'ENTRADA', incidencias: [], duplicado: false });
      const dia = await api(app, t['ana@p3.mx']).get('/v1/checador/mi-dia').expect(200);
      expect(dia.body.siguientes).toEqual(['INICIO_DESCANSO', 'SALIDA']);
      expect(dia.body.bitacora).toHaveLength(1);
    });

    it('doble toque: checada repetida', async () => {
      const r = await api(app, t['ana@p3.mx'])
        .post('/v1/checador/checadas', { tipo: 'ENTRADA', modalidad: 'LUGAR_FIJO', ocurrido_en: haceMin(15), ...CENTRO })
        .expect(422);
      expect(r.body.mensaje).toMatch(/repetida/);
    });

    it('fuera de la zona se registra, pero queda como incidencia', async () => {
      const r = await api(app, t['ana@p3.mx']).post('/v1/checador/checadas', {
        tipo: 'INICIO_DESCANSO', modalidad: 'LUGAR_FIJO', ocurrido_en: haceMin(12), lat: 20.6, lng: -100.3899,
      }).expect(201);
      expect(r.body.incidencias).toEqual(['FUERA_DE_ZONA']);
    });

    it('modalidad no habilitada: rechazada', async () => {
      await api(app, t['ana@p3.mx'])
        .post('/v1/checador/checadas', { tipo: 'FIN_DESCANSO', modalidad: 'DESDE_CASA' })
        .expect(422);
    });

    it('sin señal: el lote se aplica en orden y reenviarlo es seguro', async () => {
      const lote = {
        checadas: [
          { client_uuid: randomUUID(), tipo: 'SALIDA', modalidad: 'MOVIL', ocurrido_en: haceMin(4), ...CENTRO },
          { client_uuid: randomUUID(), tipo: 'FIN_DESCANSO', modalidad: 'MOVIL', ocurrido_en: haceMin(8), ...CENTRO },
        ],
      };
      const r1 = await api(app, t['ana@p3.mx']).post('/v1/checador/checadas/lote', lote).expect(200);
      expect(r1.body.resultados.map((r: { estado: string }) => r.estado)).toEqual(['ACEPTADO', 'ACEPTADO']);
      const r2 = await api(app, t['ana@p3.mx']).post('/v1/checador/checadas/lote', lote).expect(200);
      expect(r2.body.resultados.map((r: { estado: string }) => r.estado)).toEqual(['DUPLICADO', 'DUPLICADO']);
    });

    it('un usuario que no es trabajador no puede checar', async () => {
      await api(app, t['rh@p3.mx']).post('/v1/checador/checadas', { tipo: 'ENTRADA', modalidad: 'MOVIL' }).expect(403);
    });
  });

  describe('kiosco compartido', () => {
    it('número + PIN; el tipo se deduce (entrada)', async () => {
      await api(app, t['kiosco@p3.mx']).post('/v1/checador/kiosco', { numero: '014', pin: '9999' }).expect(401);
      const r = await api(app, t['kiosco@p3.mx']).post('/v1/checador/kiosco', { numero: '014', pin: '1234' }).expect(201);
      expect(r.body).toMatchObject({ trabajador: 'Marco Salas', tipo: 'ENTRADA', incidencias: [] });
    });

    it('5 PIN erróneos bloquean al trabajador', async () => {
      for (let i = 0; i < 5; i++) {
        await api(app, t['kiosco@p3.mx']).post('/v1/checador/kiosco', { numero: '002', pin: '0000' }).expect(401);
      }
      const r = await api(app, t['kiosco@p3.mx']).post('/v1/checador/kiosco', { numero: '002', pin: '1234' }).expect(401);
      expect(r.body.message).toMatch(/Demasiados intentos/);
    });

    it('el kiosco de otra empresa no encuentra trabajadores de P3', async () => {
      await api(app, t['rh@e2.mx']).post('/v1/checador/kiosco', { numero: '014', pin: '1234' }).expect(401);
      await api(app, t['ana@p3.mx']).post('/v1/checador/kiosco', { numero: '014', pin: '1234' }).expect(403);
    });
  });

  describe('supervisión', () => {
    it('tablero del día de P3', async () => {
      const r = await api(app, t['rh@p3.mx']).get(`/v1/checador/tablero?fecha=${fechaLocal(new Date(Date.now() - 16 * 60_000))}`)
        .expect(200);
      expect(r.body.empresa.clave).toBe('P3');
      expect(r.body.trabajadores).toHaveLength(4);
      const ana = r.body.trabajadores.find((x: { numero: string }) => x.numero === '001');
      expect(ana).toMatchObject({ estado: 'SALIO', incidencias: ['FUERA_DE_ZONA'] });
      const marco = r.body.trabajadores.find((x: { numero: string }) => x.numero === '014');
      expect(marco.estado).toBe('TRABAJANDO');
      expect(r.body.resumen.requieren_atencion).toBe(1);
      expect(r.body.incidencias[0].distancia_m).toBeGreaterThan(1000);
    });

    it('el trabajador no ve el tablero; E2 sólo ve lo suyo', async () => {
      await api(app, t['ana@p3.mx']).get('/v1/checador/tablero').expect(403);
      const e2 = await api(app, t['rh@e2.mx']).get('/v1/checador/tablero').expect(200);
      expect(e2.body.trabajadores.map((x: { nombre: string }) => x.nombre)).toEqual(['Trabajador E2']);
    });

    it('corrección con motivo y anulación (sólo dentro de la empresa)', async () => {
      await api(app, t['rh@p3.mx'])
        .post('/v1/checador/correcciones', { trabajador_id: SOFIA, tipo: 'ENTRADA', ocurrido_en: haceMin(30), motivo: 'x' })
        .expect(400);
      const c = await api(app, t['rh@p3.mx']).post('/v1/checador/correcciones', {
        trabajador_id: SOFIA, tipo: 'ENTRADA', ocurrido_en: haceMin(30), motivo: 'Visita a cliente, sin batería',
      }).expect(201);
      await api(app, t['rh@e2.mx']).post(`/v1/checador/checadas/${c.body.id}/anular`, { motivo: 'Intento ajeno' }).expect(404);
      await api(app, t['rh@p3.mx']).post(`/v1/checador/checadas/${c.body.id}/anular`, { motivo: 'Capturada por error' })
        .expect(200);
      await api(app, t['rh@p3.mx']).post(`/v1/checador/checadas/${c.body.id}/anular`, { motivo: 'Capturada por error' })
        .expect(409);
    });

    it('alta de trabajador: el usuario debe ser de la misma empresa', async () => {
      await api(app, t['rh@p3.mx']).post('/v1/checador/trabajadores', {
        numero: '020', nombre: 'Persona ajena', modalidades: ['MOVIL'], usuario_email: 'rh@e2.mx',
      }).expect(422);
      await api(app, t['rh@p3.mx']).post('/v1/checador/trabajadores', {
        numero: '020', nombre: 'Kiosco sin PIN', modalidades: ['KIOSCO'],
      }).expect(422);
      await api(app, t['rh@p3.mx']).post('/v1/checador/trabajadores', {
        numero: '020', nombre: 'Luis Mora', modalidades: ['KIOSCO'], pin: '4321', centro_id: '00000000-0000-0000-00c0-000000000201',
      }).expect(201);
      const lista = await api(app, t['rh@p3.mx']).get('/v1/checador/trabajadores').expect(200);
      expect(lista.body.find((x: { numero: string }) => x.numero === '020')).toMatchObject({ tiene_pin: true, modalidades: ['KIOSCO'] });
    });
  });

  describe('cierre de periodo', () => {
    it('cerrar, y cada trabajador acepta su asistencia una sola vez', async () => {
      const p = await api(app, t['rh@p3.mx'])
        .post('/v1/checador/periodos', { nombre: 'Periodo pasado', inicio: diaLocal(-10), fin: diaLocal(-1) }).expect(201);
      const cierre = await api(app, t['rh@p3.mx']).post(`/v1/checador/periodos/${p.body.id}/cerrar`).expect(200);
      expect(cierre.body.trabajadores).toBe(5);
      await api(app, t['rh@p3.mx']).post(`/v1/checador/periodos/${p.body.id}/cerrar`).expect(422);

      await api(app, t['ana@p3.mx']).post(`/v1/checador/periodos/${p.body.id}/respuesta`, { acepta: false }).expect(400);
      await api(app, t['ana@p3.mx']).post(`/v1/checador/periodos/${p.body.id}/respuesta`, { acepta: true }).expect(200);
      await api(app, t['ana@p3.mx']).post(`/v1/checador/periodos/${p.body.id}/respuesta`, { acepta: true }).expect(422);
      const mios = await api(app, t['ana@p3.mx']).get('/v1/checador/mis-periodos').expect(200);
      expect(mios.body[0]).toMatchObject({ nombre: 'Periodo pasado', respuesta: 'ACEPTADO' });
      const lista = await api(app, t['rh@p3.mx']).get('/v1/checador/periodos').expect(200);
      expect(lista.body[0]).toMatchObject({ estado: 'CERRADO', trabajadores: 5, aceptados: 1 });
    });

    it('no se cierra un periodo que no ha terminado', async () => {
      const p = await api(app, t['rh@p3.mx'])
        .post('/v1/checador/periodos', { nombre: 'Periodo actual', inicio: diaLocal(0), fin: diaLocal(5) }).expect(201);
      const r = await api(app, t['rh@p3.mx']).post(`/v1/checador/periodos/${p.body.id}/cerrar`).expect(422);
      expect(r.body.mensaje).toMatch(/aún no termina/);
    });
  });

  describe('vista del grupo', () => {
    it('el dueño ve un renglón por empresa, cada una con su propio registro', async () => {
      const r = await api(app, t['dueno@grupo.mx']).get('/v1/grupo/asistencia').expect(200);
      expect(r.body.empresas.map((e: { clave: string }) => e.clave)).toEqual(['E2', 'E3', 'E4', 'E5', 'P3']);
      const p3 = r.body.empresas.find((e: { clave: string }) => e.clave === 'P3');
      expect(p3.trabajando + p3.en_descanso + p3.salieron + p3.sin_registro).toBe(5);
      const e3 = r.body.empresas.find((e: { clave: string }) => e.clave === 'E3');
      expect(e3.sin_registro).toBe(0);
    });

    it('quien no supervisa no ve el consolidado', async () => {
      const r = await api(app, t['ana@p3.mx']).get('/v1/grupo/asistencia').expect(200);
      expect(r.body.empresas).toEqual([]);
    });
  });
});
