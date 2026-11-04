-- =============================================================================
-- ObraClara — Reglas del checador multi-empresa, verificadas en SQL.
-- Corre sobre una base recién migrada (sin seed) y deja todo en ROLLBACK.
--     psql -d obraclara -v ON_ERROR_STOP=1 -f demo_checador.sql
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

-- hora local de la empresa, hace `dias` días
CREATE OR REPLACE FUNCTION pg_temp.ts(dias int, hora text) RETURNS timestamptz LANGUAGE sql AS $$
  SELECT (((now() AT TIME ZONE 'America/Mexico_City')::date - dias) + hora::time) AT TIME ZONE 'America/Mexico_City'
$$;

CREATE OR REPLACE FUNCTION pg_temp.checar(trab uuid, tipo text, cuando timestamptz,
                                          modalidad text DEFAULT 'LUGAR_FIJO',
                                          lat numeric DEFAULT 20.5888, lng numeric DEFAULT -100.3899)
RETURNS oc.checadas LANGUAGE sql AS $$
  INSERT INTO oc.checadas(empresa_id, trabajador_id, tipo, medio, modalidad, ocurrido_en, lat, lng, registrado_por)
  VALUES (current_setting('oc.empresa_id')::uuid, trab, tipo::oc.tipo_checada,
          CASE WHEN modalidad = 'KIOSCO' THEN 'KIOSCO' ELSE 'CELULAR' END::oc.medio_checada,
          modalidad::oc.modalidad_checada, cuando, lat, lng, current_setting('oc.usuario_id')::uuid)
  RETURNING *
$$;

BEGIN;

INSERT INTO empresas(id, clave, nombre) VALUES
 ('00000000-0000-0000-00d0-000000000001', 'P3', 'P3'),
 ('00000000-0000-0000-00d0-000000000002', 'E2', 'Empresa 2');
INSERT INTO usuarios(id, empresa_id, email, nombre) VALUES
 ('00000000-0000-0000-00d0-000000000011', '00000000-0000-0000-00d0-000000000001', 'rh@p3.mx', 'RH P3'),
 ('00000000-0000-0000-00d0-000000000012', '00000000-0000-0000-00d0-000000000002', 'rh@e2.mx', 'RH E2');
INSERT INTO centros_trabajo(id, empresa_id, clave, nombre, lat, lng, radio_m) VALUES
 ('00000000-0000-0000-00d0-000000000021', '00000000-0000-0000-00d0-000000000001', 'CEN', 'Sucursal Centro', 20.5888, -100.3899, 180),
 ('00000000-0000-0000-00d0-000000000022', '00000000-0000-0000-00d0-000000000002', 'OFI', 'Oficina E2', 20.6, -100.38, 150);
INSERT INTO trabajadores(id, empresa_id, numero, nombre, centro_id, modalidades) VALUES
 ('00000000-0000-0000-00d0-000000000031', '00000000-0000-0000-00d0-000000000001', '001', 'Ana López',
  '00000000-0000-0000-00d0-000000000021', '{LUGAR_FIJO}'),
 ('00000000-0000-0000-00d0-000000000032', '00000000-0000-0000-00d0-000000000001', '002', 'Diego Ruiz',
  NULL, '{DESDE_CASA}'),
 ('00000000-0000-0000-00d0-000000000041', '00000000-0000-0000-00d0-000000000002', '001', 'Trabajador E2',
  '00000000-0000-0000-00d0-000000000022', '{KIOSCO}');

-- A partir de aquí, como la API: rol sin privilegios y empresa fijada
SET LOCAL ROLE oc_app;
SELECT set_config('oc.empresa_id', '00000000-0000-0000-00d0-000000000001', true),
       set_config('oc.usuario_id', '00000000-0000-0000-00d0-000000000011', true);

DO $$ BEGIN RAISE NOTICE '1) Aislamiento por empresa'; END $$;
SELECT pg_temp.afirmar((SELECT count(*) = 2 FROM trabajadores), 'P3 sólo ve sus 2 trabajadores (no el de E2)');
SELECT pg_temp.afirmar((SELECT count(*) = 1 FROM empresas), 'P3 no ve a las demás empresas');
SELECT pg_temp.debe_fallar($$SELECT pg_temp.checar('00000000-0000-0000-00d0-000000000041', 'ENTRADA', now(), 'KIOSCO')$$,
                           'inexistente');

DO $$ BEGIN RAISE NOTICE '2) Jornada completa con descanso (hace 3 días)'; END $$;
SELECT pg_temp.checar('00000000-0000-0000-00d0-000000000031', 'ENTRADA',         pg_temp.ts(3, '09:00'));
SELECT pg_temp.checar('00000000-0000-0000-00d0-000000000031', 'INICIO_DESCANSO', pg_temp.ts(3, '14:00'));
SELECT pg_temp.checar('00000000-0000-0000-00d0-000000000031', 'FIN_DESCANSO',    pg_temp.ts(3, '15:00'));
SELECT pg_temp.checar('00000000-0000-0000-00d0-000000000031', 'SALIDA',          pg_temp.ts(3, '18:00'));
SELECT pg_temp.afirmar((SELECT sum(minutos) = 480 FROM v_tramos_trabajo
                         WHERE trabajador_id = '00000000-0000-0000-00d0-000000000031'), '8 h trabajadas (9 h menos 1 h de comida)');
SELECT pg_temp.afirmar((SELECT bool_and(incidencias = '{}') FROM checadas), 'Dentro de la zona y en secuencia: sin incidencias');

DO $$ BEGIN RAISE NOTICE '3) Geocerca, secuencia y repetidos (hace 2 días)'; END $$;
SELECT pg_temp.afirmar((SELECT incidencias = '{FUERA_DE_ZONA}' AND distancia_m > 1000
                          FROM pg_temp.checar('00000000-0000-0000-00d0-000000000031', 'ENTRADA', pg_temp.ts(2, '09:00'),
                                              'LUGAR_FIJO', 20.6000, -100.3899)),
                       'Checada a 1.2 km del centro: FUERA_DE_ZONA (se registra, no se rechaza)');
SELECT pg_temp.debe_fallar($$SELECT pg_temp.checar('00000000-0000-0000-00d0-000000000031', 'ENTRADA', pg_temp.ts(2, '09:01'))$$,
                           'repetida');
SELECT pg_temp.afirmar((SELECT incidencias = '{SECUENCIA}'
                          FROM pg_temp.checar('00000000-0000-0000-00d0-000000000031', 'FIN_DESCANSO', pg_temp.ts(2, '13:00'))),
                       'Fin de descanso sin haber salido a descanso: SECUENCIA');
SELECT pg_temp.debe_fallar($$SELECT pg_temp.checar('00000000-0000-0000-00d0-000000000031', 'SALIDA', now() + interval '1 hour')$$,
                           'futuro');
SELECT pg_temp.debe_fallar($$SELECT pg_temp.checar('00000000-0000-0000-00d0-000000000031', 'SALIDA', pg_temp.ts(2, '18:00'), 'DESDE_CASA')$$,
                           'no tiene habilitada la modalidad DESDE_CASA');
SELECT pg_temp.afirmar((SELECT incidencias = '{}' FROM pg_temp.checar('00000000-0000-0000-00d0-000000000032', 'ENTRADA',
                          pg_temp.ts(2, '09:04'), 'DESDE_CASA', NULL, NULL)),
                       'Desde casa no aplica geocerca');
SELECT pg_temp.afirmar((SELECT count(*) = 1 FROM v_jornadas_abiertas
                         WHERE trabajador_id = '00000000-0000-0000-00d0-000000000032'), 'Diego quedó con jornada abierta (sin salida)');

DO $$ BEGIN RAISE NOTICE '4) Inmutabilidad y correcciones'; END $$;
SELECT pg_temp.debe_fallar($$UPDATE oc.checadas SET ocurrido_en = now()$$, 'permission denied');
SELECT pg_temp.debe_fallar($$DELETE FROM oc.checadas$$, 'permission denied');
SELECT pg_temp.debe_fallar($$INSERT INTO oc.checadas(empresa_id, trabajador_id, tipo, medio, ocurrido_en, registrado_por)
  VALUES ('00000000-0000-0000-00d0-000000000001', '00000000-0000-0000-00d0-000000000032', 'SALIDA', 'SUPERVISOR',
          now() - interval '2 days', '00000000-0000-0000-00d0-000000000011')$$, 'checada_supervisor_con_motivo');
INSERT INTO checadas(empresa_id, trabajador_id, tipo, medio, ocurrido_en, nota, registrado_por)
VALUES ('00000000-0000-0000-00d0-000000000001', '00000000-0000-0000-00d0-000000000032', 'SALIDA', 'SUPERVISOR',
        pg_temp.ts(2, '17:04'), 'Olvidó checar salida; confirmado con su jefe', '00000000-0000-0000-00d0-000000000011');
SELECT pg_temp.afirmar((SELECT count(*) = 0 FROM v_jornadas_abiertas
                         WHERE trabajador_id = '00000000-0000-0000-00d0-000000000032'), 'La corrección de supervisor cierra la jornada de Diego');
INSERT INTO checadas_anuladas(checada_id, empresa_id, motivo, anulada_por)
SELECT id, empresa_id, 'Checó por error fuera de la sucursal', '00000000-0000-0000-00d0-000000000011'
  FROM checadas WHERE 'SECUENCIA' = ANY (incidencias);
SELECT pg_temp.afirmar((SELECT count(*) = 0 FROM v_checadas_vigentes WHERE 'SECUENCIA' = ANY (incidencias)),
                       'Checada anulada: deja de contar, pero sigue en el libro');

DO $$ BEGIN RAISE NOTICE '5) Cierre de periodo y aceptación'; END $$;
INSERT INTO periodos_asistencia(empresa_id, nombre, inicio, fin)
SELECT '00000000-0000-0000-00d0-000000000001', 'Periodo de prueba', d - 6, d - 1
  FROM (SELECT (now() AT TIME ZONE 'America/Mexico_City')::date AS d) x;
SELECT pg_temp.debe_fallar($$INSERT INTO oc.periodos_asistencia(empresa_id, nombre, inicio, fin)
  SELECT '00000000-0000-0000-00d0-000000000001', 'Traslape', d - 2, d + 5
    FROM (SELECT (now() AT TIME ZONE 'America/Mexico_City')::date AS d) x$$, 'traslapa');
SELECT pg_temp.afirmar(cerrar_periodo(id) = 2, 'Periodo cerrado con 2 trabajadores') FROM periodos_asistencia;
SELECT pg_temp.afirmar((SELECT minutos_trabajados = 480 AND jornadas_abiertas = 1 AND incidencias = 1
                          FROM periodo_trabajadores WHERE trabajador_id = '00000000-0000-0000-00d0-000000000031'),
                       'Ana: 8 h, 1 incidencia (fuera de zona) y 1 jornada sin salida');
SELECT pg_temp.afirmar((SELECT correcciones = 1 FROM periodo_trabajadores
                         WHERE trabajador_id = '00000000-0000-0000-00d0-000000000032'), 'Diego: 1 corrección');
SELECT pg_temp.debe_fallar($$SELECT pg_temp.checar('00000000-0000-0000-00d0-000000000031', 'SALIDA', pg_temp.ts(2, '19:00'))$$,
                           'cerrado');
SELECT pg_temp.debe_fallar($$UPDATE oc.periodo_trabajadores SET minutos_trabajados = 9999$$, 'permission denied');
UPDATE periodo_trabajadores SET respuesta = 'ACEPTADO', respondido_en = now()
 WHERE trabajador_id = '00000000-0000-0000-00d0-000000000031';
SELECT pg_temp.debe_fallar($$UPDATE oc.periodo_trabajadores SET respuesta = 'OBJETADO', comentario = 'cambio de opinión',
                              respondido_en = now() WHERE trabajador_id = '00000000-0000-0000-00d0-000000000031'$$, 'ya respondió');

DO $$ BEGIN RAISE NOTICE '6) La otra empresa lleva su propio registro'; END $$;
SELECT set_config('oc.empresa_id', '00000000-0000-0000-00d0-000000000002', true),
       set_config('oc.usuario_id', '00000000-0000-0000-00d0-000000000012', true);
SELECT pg_temp.afirmar((SELECT count(*) = 0 FROM checadas) AND (SELECT count(*) = 0 FROM periodos_asistencia),
                       'E2 no ve checadas ni periodos de P3');
SELECT pg_temp.checar('00000000-0000-0000-00d0-000000000041', 'ENTRADA', pg_temp.ts(2, '08:00'), 'KIOSCO');
SELECT pg_temp.afirmar((SELECT count(*) = 1 FROM checadas), 'E2 checa en su kiosco: periodo de P3 cerrado no le afecta');

ROLLBACK;
