-- =============================================================================
-- ObraClara — Prueba de punta a punta de las reglas de negocio del esquema.
-- Ejecutar DESPUÉS de schema.sql:
--     psql -d obraclara -v ON_ERROR_STOP=1 -f demo_flujo.sql
-- Cada paso imprime un NOTICE; cualquier regla rota aborta con error.
-- =============================================================================
SET search_path = oc, public;
\pset tuples_only on
\set QUIET on

CREATE OR REPLACE FUNCTION pg_temp.debe_fallar(p_sql text, p_contiene text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'Se esperaba error "%" y no ocurrió: %', p_contiene, p_sql;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT ILIKE '%' || p_contiene || '%' THEN RAISE; END IF;
  RAISE NOTICE '  ✔ bloqueado como se esperaba: %', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.afirmar(p_ok boolean, p_msg text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'FALLA: %', p_msg; END IF;
  RAISE NOTICE '  ✔ %', p_msg;
END $$;

BEGIN;

-- ---------------------------------------------------------------- catálogo base
INSERT INTO empresas(id, nombre) VALUES ('00000000-0000-0000-0000-0000000000e1', 'Constructora Demo');
INSERT INTO usuarios(id, empresa_id, email, nombre) VALUES
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000e1','cabo@demo.mx','Cabo Juan'),
 ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000e1','residente@demo.mx','Ing. Residente'),
 ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-0000000000e1','compras@demo.mx','Compras'),
 ('00000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-0000000000e1','finanzas@demo.mx','Finanzas'),
 ('00000000-0000-0000-0000-00000000000f','00000000-0000-0000-0000-0000000000e1','director@demo.mx','Director');

INSERT INTO obras(id, empresa_id, clave, nombre, monto_contrato)
VALUES ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000e1','OB-01','Edificio Norte', 400000);

INSERT INTO insumos(id, empresa_id, clave, descripcion, unidad, tipo) VALUES
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-0000000000e1','CON-250','Concreto premezclado f''c=250','m3','MATERIAL'),
 ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-0000000000e1','MO-LOSA','Destajo colado de losa','m3','MANO_OBRA');

INSERT INTO proveedores(id, empresa_id, rfc, razon_social, es_contratista) VALUES
 ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-0000000000e1','CMX010101AAA','Concretera MX', false),
 ('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-0000000000e1','XAXX010101000','Cuadrilla Hernández', true);

-- ---------------------------------------------------------------- presupuesto
INSERT INTO partidas(id, obra_id, clave, descripcion)
VALUES ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-0000000000b1','03','Estructura');
INSERT INTO conceptos(id, obra_id, partida_id, clave, descripcion, unidad, cantidad_base, pu_costo_base, pu_venta)
VALUES ('00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-0000000000b1',
        '00000000-0000-0000-0000-000000000301','03.001','Losa maciza f''c=250 de 12 cm','m3', 100, 2700, 3600);
-- APU: 1.05 m3 de concreto por m3 (desperdicio 5%) a $2,000 + destajo $600/m3
INSERT INTO lineas_control(id, obra_id, concepto_id, insumo_id, cantidad_base, precio_base) VALUES
 ('00000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000401',
  '00000000-0000-0000-0000-000000000101', 105, 2000),
 ('00000000-0000-0000-0000-000000000502','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000401',
  '00000000-0000-0000-0000-000000000102', 100, 600);
INSERT INTO almacenes(id, obra_id, nombre)
VALUES ('00000000-0000-0000-0000-000000000601','00000000-0000-0000-0000-0000000000b1','Bodega obra');

UPDATE obras SET presupuesto_estado = 'AUTORIZADO', presupuesto_autorizado_en = now()
 WHERE id = '00000000-0000-0000-0000-0000000000b1';
DO $$ BEGIN RAISE NOTICE '1) Presupuesto autorizado y congelado'; END $$;
SELECT pg_temp.debe_fallar($$UPDATE oc.conceptos SET cantidad_base = 120 WHERE clave = '03.001'$$, 'inmutable');
SELECT pg_temp.debe_fallar($$UPDATE oc.lineas_control SET cantidad_vigente = 200
                             WHERE id = '00000000-0000-0000-0000-000000000501'$$, 'orden de cambio');

-- ---------------------------------------------------------------- requisición 1 (VERDE)
DO $$ BEGIN RAISE NOTICE '2) Requisición de 50 m3 de concreto'; END $$;
INSERT INTO requisiciones(id, empresa_id, obra_id, folio, solicitante_id, estado)
VALUES ('00000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-0000000000e1',
        '00000000-0000-0000-0000-0000000000b1','REQ-001','00000000-0000-0000-0000-00000000000b','BORRADOR');
INSERT INTO requisicion_lineas(id, requisicion_id, obra_id, concepto_id, linea_control_id, cantidad, precio_estimado)
VALUES ('00000000-0000-0000-0000-000000000711','00000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-0000000000b1',
        '00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000501', 50, 2000);
UPDATE requisiciones SET estado = 'ENVIADA' WHERE id = '00000000-0000-0000-0000-000000000701';
SELECT pg_temp.afirmar((SELECT semaforo = 'VERDE' FROM requisicion_lineas WHERE id = '00000000-0000-0000-0000-000000000711'),
                       'REQ-001 en VERDE (47.6% del volumen)');
UPDATE requisiciones SET estado = 'APROBADA', aprobada_por = '00000000-0000-0000-0000-00000000000b'
 WHERE id = '00000000-0000-0000-0000-000000000701';
SELECT pg_temp.afirmar((SELECT imp_reservado = 100000 FROM v_saldo_linea_control
                         WHERE linea_control_id = '00000000-0000-0000-0000-000000000501'), 'Reservados $100,000');

-- ---------------------------------------------------------------- OC + recepción
DO $$ BEGIN RAISE NOTICE '3) OC a $2,100 (5%% arriba) y recepción con remisión'; END $$;
INSERT INTO ordenes_compra(id, empresa_id, obra_id, folio, proveedor_id)
VALUES ('00000000-0000-0000-0000-000000000801','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000b1',
        'OC-001','00000000-0000-0000-0000-000000000201');
INSERT INTO oc_lineas(id, orden_compra_id, obra_id, requisicion_linea_id, concepto_id, linea_control_id, cantidad, precio_unitario)
VALUES ('00000000-0000-0000-0000-000000000811','00000000-0000-0000-0000-000000000801','00000000-0000-0000-0000-0000000000b1',
        '00000000-0000-0000-0000-000000000711','00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000501', 50, 2100);
UPDATE ordenes_compra SET estado = 'EMITIDA', emitida_por = '00000000-0000-0000-0000-00000000000c'
 WHERE id = '00000000-0000-0000-0000-000000000801';
SELECT pg_temp.afirmar((SELECT imp_reservado = 0 AND imp_comprometido = 105000 FROM v_saldo_linea_control
                         WHERE linea_control_id = '00000000-0000-0000-0000-000000000501'),
                       'Reserva liberada, comprometido $105,000');
SELECT pg_temp.afirmar((SELECT semaforo_precio = 'AMARILLO' FROM oc_lineas WHERE id = '00000000-0000-0000-0000-000000000811'),
                       'Semáforo de precio AMARILLO');

INSERT INTO recepciones(id, obra_id, orden_compra_id, almacen_id, recibio_id, remision_folio)
VALUES ('00000000-0000-0000-0000-000000000901','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000801',
        '00000000-0000-0000-0000-000000000601','00000000-0000-0000-0000-00000000000b','REM-7781');
SELECT pg_temp.debe_fallar($$INSERT INTO oc.recepcion_lineas(recepcion_id, oc_linea_id, cantidad_aceptada)
                             VALUES ('00000000-0000-0000-0000-000000000901','00000000-0000-0000-0000-000000000811', 60)$$,
                           'excede lo ordenado');
INSERT INTO recepcion_lineas(recepcion_id, oc_linea_id, cantidad_aceptada)
VALUES ('00000000-0000-0000-0000-000000000901','00000000-0000-0000-0000-000000000811', 50);
SELECT pg_temp.afirmar((SELECT imp_comprometido = 0 AND imp_ejercido = 105000 FROM v_saldo_linea_control
                         WHERE linea_control_id = '00000000-0000-0000-0000-000000000501'), 'Ejercido $105,000');
SELECT pg_temp.afirmar((SELECT estado = 'RECIBIDA' FROM ordenes_compra WHERE id = '00000000-0000-0000-0000-000000000801'),
                       'OC-001 RECIBIDA');
SELECT pg_temp.afirmar((SELECT existencia = 50 FROM v_existencias WHERE insumo_id = '00000000-0000-0000-0000-000000000101'),
                       'Existencia en bodega: 50 m3');

-- ---------------------------------------------------------------- requisición 2 (ROJO -> orden de cambio)
DO $$ BEGIN RAISE NOTICE '4) Requisición de 70 m3 más (rebasa presupuesto)'; END $$;
INSERT INTO requisiciones(id, empresa_id, obra_id, folio, solicitante_id)
VALUES ('00000000-0000-0000-0000-000000000702','00000000-0000-0000-0000-0000000000e1',
        '00000000-0000-0000-0000-0000000000b1','REQ-002','00000000-0000-0000-0000-00000000000b');
INSERT INTO requisicion_lineas(id, requisicion_id, obra_id, concepto_id, linea_control_id, cantidad, precio_estimado)
VALUES ('00000000-0000-0000-0000-000000000721','00000000-0000-0000-0000-000000000702','00000000-0000-0000-0000-0000000000b1',
        '00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000501', 70, 2000);
UPDATE requisiciones SET estado = 'ENVIADA' WHERE id = '00000000-0000-0000-0000-000000000702';
SELECT pg_temp.afirmar((SELECT semaforo = 'ROJO' FROM requisicion_lineas WHERE id = '00000000-0000-0000-0000-000000000721'),
                       'REQ-002 en ROJO');
SELECT pg_temp.debe_fallar($$UPDATE oc.requisiciones SET estado = 'APROBADA'
                             WHERE id = '00000000-0000-0000-0000-000000000702'$$, 'ROJO');

INSERT INTO ordenes_cambio(id, obra_id, folio, tipo, motivo, estado, solicitado_por)
VALUES ('00000000-0000-0000-0000-000000000a01','00000000-0000-0000-0000-0000000000b1','OCB-001','ADITIVA',
        'Sobre-espesor por deflexión de cimbra: +21 m3 de concreto','SOLICITADA','00000000-0000-0000-0000-00000000000b');
INSERT INTO ordenes_cambio_lineas(orden_cambio_id, obra_id, concepto_id, linea_control_id, delta_cantidad)
VALUES ('00000000-0000-0000-0000-000000000a01','00000000-0000-0000-0000-0000000000b1',
        '00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000501', 21);
SELECT fn_aplicar_orden_cambio('00000000-0000-0000-0000-000000000a01','00000000-0000-0000-0000-00000000000f');
-- el residente regresa la requisición a borrador y la re-envía
UPDATE requisiciones SET estado = 'BORRADOR' WHERE id = '00000000-0000-0000-0000-000000000702';
UPDATE requisiciones SET estado = 'ENVIADA'  WHERE id = '00000000-0000-0000-0000-000000000702';
-- 120/126 = 95% del volumen, pero avance físico 0% => AMARILLO por consumo anticipado
SELECT pg_temp.afirmar((SELECT semaforo = 'AMARILLO' FROM requisicion_lineas WHERE id = '00000000-0000-0000-0000-000000000721'),
                       'Tras orden de cambio: AMARILLO por consumo anticipado');
SELECT pg_temp.debe_fallar($$UPDATE oc.requisiciones SET estado = 'APROBADA'
                             WHERE id = '00000000-0000-0000-0000-000000000702'$$, 'justificación');
UPDATE requisicion_lineas SET justificacion = 'Colado continuo de losa completa el sábado',
       autoriza_excepcion_por = '00000000-0000-0000-0000-00000000000f'
 WHERE id = '00000000-0000-0000-0000-000000000721';
UPDATE requisiciones SET estado = 'APROBADA' WHERE id = '00000000-0000-0000-0000-000000000702';
DO $$ BEGIN RAISE NOTICE '  ✔ REQ-002 aprobada con justificación'; END $$;

-- ---------------------------------------------------------------- destajo
DO $$ BEGIN RAISE NOTICE '5) Contrato de destajo, avance con foto y estimación semanal'; END $$;
INSERT INTO contratos_destajo(id, obra_id, contratista_id, folio, pct_fondo_garantia, monto_anticipo, pct_amortizacion)
VALUES ('00000000-0000-0000-0000-000000000b01','00000000-0000-0000-0000-0000000000b1',
        '00000000-0000-0000-0000-000000000202','DST-001', 5, 6000, 10);
INSERT INTO contrato_destajo_lineas(id, contrato_id, obra_id, concepto_id, linea_control_id, cantidad_contratada, pu_destajo)
VALUES ('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000b01','00000000-0000-0000-0000-0000000000b1',
        '00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000502', 100, 600);
UPDATE contratos_destajo SET estado = 'VIGENTE' WHERE id = '00000000-0000-0000-0000-000000000b01';
SELECT pg_temp.afirmar((SELECT imp_comprometido = 60000 FROM v_saldo_linea_control
                         WHERE linea_control_id = '00000000-0000-0000-0000-000000000502'), 'Destajo comprometido $60,000');

INSERT INTO avances(id, obra_id, concepto_id, contrato_linea_id, cantidad, fecha, capturado_por)
VALUES ('00000000-0000-0000-0000-000000000c01','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000401',
        '00000000-0000-0000-0000-000000000b11', 30, current_date - 2, '00000000-0000-0000-0000-00000000000a');
SELECT pg_temp.debe_fallar($$UPDATE oc.avances SET estado = 'VALIDADO', validado_por = '00000000-0000-0000-0000-00000000000a'
                             WHERE id = '00000000-0000-0000-0000-000000000c01'$$, 'Segregación');
SELECT pg_temp.debe_fallar($$UPDATE oc.avances SET estado = 'VALIDADO', validado_por = '00000000-0000-0000-0000-00000000000b'
                             WHERE id = '00000000-0000-0000-0000-000000000c01'$$, 'Sin foto');
INSERT INTO archivos(id, empresa_id, storage_key, mime, sha256, lat, lng, subido_por)
VALUES ('00000000-0000-0000-0000-000000000d01','00000000-0000-0000-0000-0000000000e1','demo/ob01/losa-30m3.jpg',
        'image/jpeg','9f2c…a1', 19.4326, -99.1332, '00000000-0000-0000-0000-00000000000a');
INSERT INTO evidencias(archivo_id, entidad_tipo, entidad_id)
VALUES ('00000000-0000-0000-0000-000000000d01','AVANCE','00000000-0000-0000-0000-000000000c01');
UPDATE avances SET estado = 'VALIDADO', validado_por = '00000000-0000-0000-0000-00000000000b'
 WHERE id = '00000000-0000-0000-0000-000000000c01';
DO $$ BEGIN RAISE NOTICE '  ✔ Avance de 30 m3 validado por el residente'; END $$;

SELECT fn_generar_estimacion_destajo('00000000-0000-0000-0000-000000000b01', current_date) AS est_id \gset
SELECT pg_temp.afirmar((SELECT subtotal = 18000 AND amortizacion_anticipo = 1800 AND retencion_fg = 900
                               AND neto_a_pagar = 15300
                          FROM estimaciones_destajo WHERE id = :'est_id'),
                       'Estimación 1: 30 m3 × $600 = $18,000 − anticipo $1,800 − FG $900 = $15,300');
SELECT pg_temp.debe_fallar(format($$SELECT oc.fn_generar_estimacion_destajo(%L, current_date)$$,
                                  '00000000-0000-0000-0000-000000000b01'), 'estimación abierta');
SELECT pg_temp.debe_fallar(format($$UPDATE oc.estimaciones_destajo SET estado = 'APROBADA',
                                    revisada_por = '00000000-0000-0000-0000-00000000000d',
                                    aprobada_por = '00000000-0000-0000-0000-00000000000d' WHERE id = %L$$, :'est_id'),
                           'personas distintas');
UPDATE estimaciones_destajo SET estado = 'APROBADA', revisada_por = '00000000-0000-0000-0000-00000000000b',
       aprobada_por = '00000000-0000-0000-0000-00000000000d' WHERE id = :'est_id';
SELECT pg_temp.afirmar((SELECT imp_comprometido = 42000 AND imp_ejercido = 18000 FROM v_saldo_linea_control
                         WHERE linea_control_id = '00000000-0000-0000-0000-000000000502'),
                       'Destajo: comprometido $42,000 / ejercido $18,000');

-- ---------------------------------------------------------------- pago
DO $$ BEGIN RAISE NOTICE '6) Pago de la estimación'; END $$;
INSERT INTO pagos(id, empresa_id, proveedor_id, fecha, monto, metodo, registrado_por)
VALUES ('00000000-0000-0000-0000-000000000e01','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-000000000202',
        current_date, 15300, 'SPEI', '00000000-0000-0000-0000-00000000000d');
SELECT pg_temp.debe_fallar(format($$INSERT INTO oc.pago_aplicaciones(pago_id, estimacion_id, importe)
                                    VALUES ('00000000-0000-0000-0000-000000000e01', %L, 20000)$$, :'est_id'), 'excede');
INSERT INTO pago_aplicaciones(pago_id, estimacion_id, importe)
VALUES ('00000000-0000-0000-0000-000000000e01', :'est_id', 15300);
SELECT pg_temp.afirmar((SELECT estado = 'PAGADA' FROM estimaciones_destajo WHERE id = :'est_id'), 'Estimación PAGADA');
SELECT pg_temp.afirmar((SELECT retenido = 900 FROM v_fondo_garantia), 'Fondo de garantía retenido: $900');

-- ---------------------------------------------------------------- inmutabilidad + KPIs
SELECT pg_temp.debe_fallar($$DELETE FROM oc.mov_presupuestales$$, 'append-only');

DO $$ BEGIN RAISE NOTICE '7) KPIs de la obra'; END $$;
\pset tuples_only off
SELECT bac, ev, ac, comprometido, pagado, pct_avance_fisico, pct_avance_financiero, cpi, eac, margen_proyectado
  FROM v_kpi_obra;
SELECT clave, pct_fisico, pct_financiero, cpi FROM v_kpi_concepto;
SELECT linea_control_id, importe_vigente, imp_reservado, imp_comprometido, imp_ejercido, imp_pagado, imp_disponible
  FROM v_saldo_linea_control ORDER BY linea_control_id;

ROLLBACK;  -- la demo no deja datos
