import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { api, crearApp, IDS, login, StorageFalso } from './helpers';

// Flujo completo sobre una base real con migraciones + seed_dev.sql.
// Los casos son secuenciales: cada uno parte del estado que dejó el anterior.
describe('ObraClara API', () => {
  let app: INestApplication;
  const storage = new StorageFalso();
  const t: Record<string, string> = {};

  beforeAll(async () => {
    app = await crearApp(storage);
    for (const u of ['cabo', 'residente', 'compras', 'director']) t[u] = await login(app, `${u}@demo.mx`);
    t.ajeno = await login(app, 'director@otra.mx');
  });
  afterAll(() => app.close());

  const lineaConcreto = async (token: string) => {
    const r = await api(app, token).get(`/v1/obras/${IDS.obra}/presupuesto`).expect(200);
    const losa = r.body.find((c: { clave: string }) => c.clave === '03.01.001');
    return losa.lineas.find((l: { linea_control_id: string }) => l.linea_control_id === IDS.lcConcreto);
  };

  const nuevaRequisicion = async (cantidad: number, precio = 2000) => {
    const r = await api(app, t.residente).post('/v1/requisiciones', {
      obra_id: IDS.obra,
      lineas: [{ linea_control_id: IDS.lcConcreto, cantidad, precio_estimado: precio }],
    }).expect(201);
    return r.body as { id: string; folio: string };
  };

  describe('acceso', () => {
    it('health es público; lo demás exige token', async () => {
      await api(app).get('/v1/health').expect(200, { status: 'ok', db: 'ok' });
      await api(app).get('/v1/obras').expect(401);
    });

    it('cada empresa sólo ve sus obras (RLS)', async () => {
      const propias = await api(app, t.residente).get('/v1/obras').expect(200);
      expect(propias.body.map((o: { clave: string }) => o.clave)).toEqual(['OB-01']);
      expect(propias.body[0].roles.sort()).toEqual(['ALMACEN', 'RESIDENTE']);
      const ajenas = await api(app, t.ajeno).get('/v1/obras').expect(200);
      expect(ajenas.body.map((o: { clave: string }) => o.clave)).toEqual(['OX-01']);
      await api(app, t.ajeno).get(`/v1/obras/${IDS.obra}/presupuesto`).expect(403);
      await api(app, t.ajeno).get(`/v1/obras/${IDS.obra}/kpis`).expect(403);
    });

    it('el cabo ve cantidades pero no importes', async () => {
      const cabo = await lineaConcreto(t.cabo);
      expect(cabo.cantidad_vigente).toBe(105);
      expect(cabo.importe_vigente).toBe(0);
      const residente = await lineaConcreto(t.residente);
      expect(residente.importe_vigente).toBe(210000);
    });
  });

  describe('requisiciones y semáforo', () => {
    it('vista previa: VERDE dentro de presupuesto, ROJO si excede', async () => {
      const verde = await api(app, t.residente)
        .post('/v1/requisiciones/validar', { linea_control_id: IDS.lcConcreto, cantidad: 50, precio_estimado: 2000 })
        .expect(200);
      expect(verde.body.resultado).toBe('VERDE');
      const rojo = await api(app, t.residente)
        .post('/v1/requisiciones/validar', { linea_control_id: IDS.lcConcreto, cantidad: 200, precio_estimado: 2000 })
        .expect(200);
      expect(rojo.body.resultado).toBe('ROJO');
      expect(rojo.body.detalle.motivos[0]).toMatch(/Excede presupuesto/);
    });

    it('rechaza datos inválidos con detalle por campo', async () => {
      const r = await api(app, t.residente)
        .post('/v1/requisiciones', { obra_id: IDS.obra, lineas: [{ linea_control_id: IDS.lcConcreto, cantidad: -1, precio_estimado: 1 }] })
        .expect(400);
      expect(r.body.errores[0].campo).toBe('lineas.0.cantidad');
    });

    it('VERDE: crear → enviar → aprobar reserva el importe', async () => {
      const req = await nuevaRequisicion(50);
      expect(req.folio).toBe('REQ-0001');
      const enviada = await api(app, t.residente).post(`/v1/requisiciones/${req.id}/enviar`).expect(200);
      expect(enviada.body.lineas[0].semaforo).toBe('VERDE');
      await api(app, t.cabo).post(`/v1/requisiciones/${req.id}/aprobar`).expect(403);
      const aprobada = await api(app, t.residente).post(`/v1/requisiciones/${req.id}/aprobar`).expect(200);
      expect(aprobada.body.estado).toBe('APROBADA');
      expect((await lineaConcreto(t.residente)).imp_reservado).toBe(100000);
    });

    it('AMARILLO: exige justificación autorizada por gerente o director', async () => {
      const req = await nuevaRequisicion(10, 2300); // precio 15 % arriba
      const enviada = await api(app, t.residente).post(`/v1/requisiciones/${req.id}/enviar`).expect(200);
      const linea = enviada.body.lineas[0];
      expect(linea.semaforo).toBe('AMARILLO');
      const sinJustificar = await api(app, t.residente).post(`/v1/requisiciones/${req.id}/aprobar`).expect(422);
      expect(sinJustificar.body.mensaje).toMatch(/justificación/);
      const excepcion = { requisicion_linea_id: linea.id, justificacion: 'Único proveedor con entrega el sábado' };
      await api(app, t.residente).post(`/v1/requisiciones/${req.id}/excepciones`, excepcion).expect(403);
      await api(app, t.director).post(`/v1/requisiciones/${req.id}/excepciones`, excepcion).expect(200);
      await api(app, t.residente).post(`/v1/requisiciones/${req.id}/aprobar`).expect(200);
    });

    it('ROJO: queda bloqueada y no admite excepción', async () => {
      const req = await nuevaRequisicion(60);
      const enviada = await api(app, t.residente).post(`/v1/requisiciones/${req.id}/enviar`).expect(200);
      expect(enviada.body.lineas[0].semaforo).toBe('ROJO');
      const r = await api(app, t.residente).post(`/v1/requisiciones/${req.id}/aprobar`).expect(422);
      expect(r.body.mensaje).toMatch(/ROJO.*orden de cambio/);
      await api(app, t.director)
        .post(`/v1/requisiciones/${req.id}/excepciones`, { requisicion_linea_id: enviada.body.lineas[0].id, justificacion: 'urge' + 'nte' })
        .expect(422);
      await api(app, t.residente).post(`/v1/requisiciones/${req.id}/devolver`).expect(200);
    });

    it('lista la bandeja con el peor semáforo por requisición', async () => {
      const r = await api(app, t.residente).get(`/v1/obras/${IDS.obra}/requisiciones`).expect(200);
      const porFolio = Object.fromEntries(r.body.map((x: { folio: string; peor_semaforo: string }) => [x.folio, x.peor_semaforo]));
      expect(porFolio).toMatchObject({ 'REQ-0001': 'VERDE', 'REQ-0002': 'AMARILLO', 'REQ-0003': 'ROJO' });
    });
  });

  describe('sincronización offline y evidencias', () => {
    const avanceUuid = randomUUID();
    const reqUuid = randomUUID();
    const malUuid = randomUUID();
    const ahora = new Date().toISOString();
    const comandos = [
      { tipo: 'AVANCE_CREAR', client_uuid: avanceUuid, obra_id: IDS.obra, creado_en: ahora,
        payload: { concepto_id: IDS.conceptoLosa, cantidad: 30, fecha: ahora.slice(0, 10), ubicacion_texto: 'Nivel 2, ejes 3-5' } },
      { tipo: 'REQUISICION_CREAR', client_uuid: reqUuid, obra_id: IDS.obra, creado_en: ahora,
        payload: { lineas: [{ linea_control_id: IDS.lcAcero, cantidad: 500, precio_estimado: 19 }] } },
      { tipo: 'REQUISICION_CREAR', client_uuid: malUuid, obra_id: IDS.obra, creado_en: ahora,
        payload: { lineas: [{ linea_control_id: randomUUID(), cantidad: 1, precio_estimado: 1 }] } },
    ];
    let avanceId: string;

    it('aplica cada comando por separado y es idempotente', async () => {
      const r1 = await api(app, t.cabo).post('/v1/sync/push', { comandos }).expect(200);
      expect(r1.body.resultados.map((x: { estado: string }) => x.estado)).toEqual(['ACEPTADO', 'ACEPTADO', 'RECHAZADO']);
      expect(r1.body.resultados[2].motivo).toMatch(/Línea de control no encontrada/);
      avanceId = r1.body.resultados[0].id;

      const r2 = await api(app, t.cabo).post('/v1/sync/push', { comandos }).expect(200);
      expect(r2.body.resultados.map((x: { estado: string }) => x.estado)).toEqual(['DUPLICADO', 'DUPLICADO', 'RECHAZADO']);
      expect(r2.body.resultados[0].id).toBe(avanceId);
    });

    it('sin foto no hay avance validado', async () => {
      const r = await api(app, t.residente).post(`/v1/avances/${avanceId}/validar`).expect(422);
      expect(r.body.mensaje).toMatch(/Sin foto/);
    });

    it('la foto se registra sólo cuando ya está en el almacenamiento', async () => {
      const pre = await api(app, t.cabo).post('/v1/archivos/prefirmar', {
        obra_id: IDS.obra, mime: 'image/jpeg', bytes: 182_000, sha256: 'a'.repeat(64),
      }).expect(201);
      expect(pre.body.upload_url).toContain('/obraclara-test/');
      const confirmar = {
        archivo_id: pre.body.archivo_id, entidad_tipo: 'AVANCE', entidad_id: avanceId,
        tomada_en: new Date().toISOString(), lat: 20.5888, lng: -100.3899,
      };
      await api(app, t.cabo).post('/v1/archivos/confirmar', confirmar).expect(422);
      storage.subido = true;
      await api(app, t.cabo).post('/v1/archivos/confirmar', confirmar).expect(200);
    });

    it('el residente valida el avance del cabo', async () => {
      await api(app, t.cabo).post(`/v1/avances/${avanceId}/validar`).expect(403);
      const r = await api(app, t.residente).post(`/v1/avances/${avanceId}/validar`).expect(200);
      expect(r.body.estado).toBe('VALIDADO');
      await api(app, t.residente).post(`/v1/avances/${avanceId}/validar`).expect(409);
    });

    it('pull entrega la réplica de la obra y el estado de lo capturado', async () => {
      const r = await api(app, t.cabo).get(`/v1/sync/pull/${IDS.obra}`).expect(200);
      expect(r.body.obra.clave).toBe('OB-01');
      expect(r.body.roles).toEqual(['CABO']);
      const losa = r.body.conceptos.find((c: { clave: string }) => c.clave === '03.01.001');
      expect(losa.pct_fisico).toBe(30);
      expect(losa.lineas[0].importe_vigente).toBe(0);
      const mios = Object.fromEntries(r.body.mis_documentos.map((d: { client_uuid: string; estado: string }) => [d.client_uuid, d.estado]));
      expect(mios).toEqual({ [avanceUuid]: 'VALIDADO', [reqUuid]: 'BORRADOR' });
    });
  });

  describe('dashboard', () => {
    it('KPIs reflejan el avance físico validado', async () => {
      const r = await api(app, t.director).get(`/v1/obras/${IDS.obra}/kpis`).expect(200);
      expect(r.body.pct_avance_fisico).toBeGreaterThan(0);
      expect(r.body.ev).toBe(81000); // 30 % de la losa ($270,000)
      await api(app, t.cabo).get(`/v1/obras/${IDS.obra}/kpis`).expect(403);
    });
  });
});
