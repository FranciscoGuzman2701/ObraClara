-- =============================================================================
-- Datos de ejemplo: grupo con P3 + 4 empresas. Correr sobre una base recién
-- migrada (pnpm db:reset). Contraseña de todas las cuentas: demo1234
--
--   dueno@grupo.mx    ADMIN en las 5 empresas (vista del grupo)
--   rh@p3.mx          RH de P3            supervisor@p3.mx  SUPERVISOR de P3
--   ana@p3.mx · diego@p3.mx · sofia@p3.mx   trabajadores de P3 (checan en su celular)
--   rh@e2.mx          RH de la Empresa 2 (para comprobar el aislamiento)
--
-- Kioscos (en la pantalla "Kiosco" se pega el código de activación):
--   P3 · Sucursal Centro   demo-kiosco-centro     P3 · Almacén Norte   demo-kiosco-norte
--   E2 · Oficina           demo-kiosco-e2         (E3…E5: demo-kiosco-e3 … demo-kiosco-e5)
--   PIN de los trabajadores de kiosco: 014 → 1234, 015 → 2345, 016 → 3456 (E2: 101 → 1111)
-- =============================================================================
SET search_path = checador, public;
BEGIN;

INSERT INTO grupos(id, nombre) VALUES ('00000000-0000-4000-8000-000000000001', 'Grupo');

INSERT INTO empresas(id, grupo_id, clave, nombre) VALUES
 ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'P3', 'P3'),
 ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001', 'E2', 'Empresa 2'),
 ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-000000000001', 'E3', 'Empresa 3'),
 ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-000000000001', 'E4', 'Empresa 4'),
 ('00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-000000000001', 'E5', 'Empresa 5');

INSERT INTO cuentas(id, email, nombre, password_hash)
SELECT id::uuid, email, nombre, crypt('demo1234', gen_salt('bf', 8)) FROM (VALUES
 ('00000000-0000-4000-8000-0000000000b1', 'dueno@grupo.mx',     'Dirección del grupo'),
 ('00000000-0000-4000-8000-0000000000b2', 'rh@p3.mx',           'Laura Méndez (RH)'),
 ('00000000-0000-4000-8000-0000000000b3', 'supervisor@p3.mx',   'Raúl Ortega (supervisor)'),
 ('00000000-0000-4000-8000-0000000000b4', 'ana@p3.mx',          'Ana López'),
 ('00000000-0000-4000-8000-0000000000b5', 'diego@p3.mx',        'Diego Ruiz'),
 ('00000000-0000-4000-8000-0000000000b6', 'sofia@p3.mx',        'Sofía Cruz'),
 ('00000000-0000-4000-8000-0000000000b7', 'rh@e2.mx',           'RH Empresa 2')
) v(id, email, nombre);

INSERT INTO centros(id, empresa_id, clave, nombre, direccion, lat, lng, radio_m) VALUES
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', 'CEN', 'Sucursal Centro', 'Av. del Trabajo 120', 20.588800, -100.389900, 180),
 ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a1', 'NTE', 'Almacén Norte',   'Calle Central 45',    20.640000, -100.410000, 150),
 ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000a2', 'OFI', 'Oficina',         NULL,                  20.600000, -100.380000, 150),
 ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000a3', 'OFI', 'Oficina',         NULL,                  20.610000, -100.370000, 150),
 ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-4000-8000-0000000000a4', 'OFI', 'Oficina',         NULL,                  20.620000, -100.360000, 150),
 ('00000000-0000-4000-8000-0000000000c6', '00000000-0000-4000-8000-0000000000a5', 'OFI', 'Oficina',         NULL,                  20.630000, -100.350000, 150);

INSERT INTO trabajadores(id, empresa_id, numero, nombre, puesto, centro_id, modalidades, hora_entrada, pin_hash) VALUES
 ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a1', '001', 'Ana López',     'Recepción',     '00000000-0000-4000-8000-0000000000c1', '{LUGAR_FIJO,MOVIL}', '09:00', NULL),
 ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000a1', '002', 'Diego Ruiz',    'Sistemas',      '00000000-0000-4000-8000-0000000000c1', '{LUGAR_FIJO,DESDE_CASA}', '09:00', NULL),
 ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000a1', '003', 'Sofía Cruz',    'Ventas',        '00000000-0000-4000-8000-0000000000c1', '{MOVIL}', NULL, NULL),
 ('00000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000a1', '014', 'Marco Salas',   'Almacén',       '00000000-0000-4000-8000-0000000000c2', '{KIOSCO}', '08:00', crypt('1234', gen_salt('bf', 8))),
 ('00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000a1', '015', 'Lucía Herrera', 'Almacén',       '00000000-0000-4000-8000-0000000000c2', '{KIOSCO}', '08:00', crypt('2345', gen_salt('bf', 8))),
 ('00000000-0000-4000-8000-0000000000d6', '00000000-0000-4000-8000-0000000000a1', '016', 'Jorge Pineda',  'Mostrador',     '00000000-0000-4000-8000-0000000000c1', '{KIOSCO,LUGAR_FIJO}', '09:00', crypt('3456', gen_salt('bf', 8))),
 ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a2', '101', 'Carmen Ríos',   'Administración','00000000-0000-4000-8000-0000000000c3', '{KIOSCO}', '09:00', crypt('1111', gen_salt('bf', 8))),
 ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000a2', '102', 'Pedro Lara',    'Operación',     '00000000-0000-4000-8000-0000000000c3', '{KIOSCO}', '09:00', crypt('2222', gen_salt('bf', 8))),
 ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000a3', '201', 'Rosa Vega',     'Operación',     '00000000-0000-4000-8000-0000000000c4', '{KIOSCO}', '09:00', crypt('1111', gen_salt('bf', 8))),
 ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000a4', '301', 'Luis Mora',     'Operación',     '00000000-0000-4000-8000-0000000000c5', '{KIOSCO}', '09:00', crypt('1111', gen_salt('bf', 8))),
 ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000a5', '401', 'Elena Soto',    'Operación',     '00000000-0000-4000-8000-0000000000c6', '{KIOSCO}', '09:00', crypt('1111', gen_salt('bf', 8)));

INSERT INTO membresias(cuenta_id, empresa_id, rol, trabajador_id)
SELECT '00000000-0000-4000-8000-0000000000b1'::uuid, id, 'ADMIN', NULL FROM empresas;
INSERT INTO membresias(cuenta_id, empresa_id, rol, trabajador_id) VALUES
 ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a1', 'RH', NULL),
 ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a1', 'SUPERVISOR', NULL),
 ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000a1', 'TRABAJADOR', '00000000-0000-4000-8000-0000000000d1'),
 ('00000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-0000000000a1', 'TRABAJADOR', '00000000-0000-4000-8000-0000000000d2'),
 ('00000000-0000-4000-8000-0000000000b6', '00000000-0000-4000-8000-0000000000a1', 'TRABAJADOR', '00000000-0000-4000-8000-0000000000d3'),
 ('00000000-0000-4000-8000-0000000000b7', '00000000-0000-4000-8000-0000000000a2', 'RH', NULL);

INSERT INTO dispositivos(id, empresa_id, centro_id, nombre, token_hash, creado_por) VALUES
 ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1',
  'Tableta recepción', encode(digest('demo-kiosco-centro', 'sha256'), 'hex'), '00000000-0000-4000-8000-0000000000b2'),
 ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c2',
  'Tableta almacén', encode(digest('demo-kiosco-norte', 'sha256'), 'hex'), '00000000-0000-4000-8000-0000000000b2'),
 ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000c3',
  'Tableta oficina', encode(digest('demo-kiosco-e2', 'sha256'), 'hex'), '00000000-0000-4000-8000-0000000000b7'),
 ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000c4',
  'Tableta oficina', encode(digest('demo-kiosco-e3', 'sha256'), 'hex'), '00000000-0000-4000-8000-0000000000b1'),
 ('00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c5',
  'Tableta oficina', encode(digest('demo-kiosco-e4', 'sha256'), 'hex'), '00000000-0000-4000-8000-0000000000b1'),
 ('00000000-0000-4000-8000-0000000000f6', '00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-0000000000c6',
  'Tableta oficina', encode(digest('demo-kiosco-e5', 'sha256'), 'hex'), '00000000-0000-4000-8000-0000000000b1');

-- -----------------------------------------------------------------------------
-- Una semana de asistencia (los 6 días anteriores a hoy, sin domingos)
-- -----------------------------------------------------------------------------
CREATE FUNCTION pg_temp.checar(trab uuid, tipo text, cuando timestamptz, lat numeric DEFAULT NULL, lng numeric DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE t trabajadores; mod modalidad; cuenta uuid; disp uuid;
BEGIN
  SELECT * INTO t FROM trabajadores WHERE id = trab;
  mod := t.modalidades[1];
  SELECT cuenta_id INTO cuenta FROM membresias WHERE trabajador_id = trab;
  IF mod = 'KIOSCO' THEN
    SELECT id INTO disp FROM dispositivos WHERE centro_id = t.centro_id LIMIT 1;
    cuenta := NULL;
  END IF;
  INSERT INTO checadas(empresa_id, trabajador_id, tipo, medio, modalidad, ocurrido_en, lat, lng, precision_m,
                       cuenta_id, dispositivo_id)
  VALUES (t.empresa_id, trab, tipo::tipo_checada,
          CASE WHEN mod = 'KIOSCO' THEN 'KIOSCO' ELSE 'CELULAR' END::medio_checada, mod, cuando,
          CASE WHEN mod = 'LUGAR_FIJO' THEN COALESCE(lat, 20.58885) WHEN mod = 'MOVIL' THEN COALESCE(lat, 20.5950) END,
          CASE WHEN mod = 'LUGAR_FIJO' THEN COALESCE(lng, -100.38985) WHEN mod = 'MOVIL' THEN COALESCE(lng, -100.4010) END,
          CASE WHEN mod IN ('LUGAR_FIJO', 'MOVIL') THEN 15 END, cuenta, disp);
END $$;

DO $$
DECLARE
  hoy date := (now() AT TIME ZONE 'America/Mexico_City')::date;
  d   date;
  i   int;
  t   record;
  h   timestamp;
  jornada_abierta boolean;
BEGIN
  FOR i IN REVERSE 6..1 LOOP
    d := hoy - i;
    CONTINUE WHEN extract(dow FROM d) = 0;
    FOR t IN SELECT id, numero, hora_entrada FROM trabajadores ORDER BY numero LOOP
      -- entrada con unos minutos de variación; algunos retardos a propósito
      h := d + COALESCE(t.hora_entrada, '09:30') - interval '7 minutes' + ((t.numero::int * 7 + i * 3) % 12) * interval '1 minute';
      IF t.numero = '001' AND i = 5 THEN h := h + interval '25 minutes'; END IF;   -- retardo de Ana
      IF t.numero = '015' AND i = 2 THEN h := h + interval '40 minutes'; END IF;   -- retardo de Lucía
      PERFORM pg_temp.checar(t.id, 'ENTRADA', h AT TIME ZONE 'America/Mexico_City',
                             CASE WHEN t.numero = '002' AND i = 2 THEN 20.6000 END);     -- Diego fuera de zona
      PERFORM pg_temp.checar(t.id, 'INICIO_DESCANSO', (d + time '14:00' + (i % 3) * interval '5 minutes') AT TIME ZONE 'America/Mexico_City');
      PERFORM pg_temp.checar(t.id, 'FIN_DESCANSO', (d + time '15:00' + (i % 3) * interval '5 minutes') AT TIME ZONE 'America/Mexico_City');
      jornada_abierta := t.numero = '014' AND i = 4;                                   -- Marco olvidó checar salida
      IF NOT jornada_abierta THEN
        PERFORM pg_temp.checar(t.id, 'SALIDA',
          (d + COALESCE(t.hora_entrada, '09:30') + interval '9 hours' + ((t.numero::int + i) % 9) * interval '1 minute')
            AT TIME ZONE 'America/Mexico_City');
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- corrección de RH: Sofía avisó que no pudo checar su salida un día
INSERT INTO checadas_anuladas(checada_id, empresa_id, motivo, anulada_por)
SELECT c.id, c.empresa_id, 'Checó dos veces por error; se conserva la primera', '00000000-0000-4000-8000-0000000000b2'
  FROM checadas c WHERE c.trabajador_id = '00000000-0000-4000-8000-0000000000d3' AND c.tipo = 'SALIDA'
 ORDER BY c.ocurrido_en DESC LIMIT 1;
INSERT INTO checadas(empresa_id, trabajador_id, tipo, medio, ocurrido_en, nota, cuenta_id)
SELECT c.empresa_id, c.trabajador_id, 'SALIDA', 'SUPERVISOR', c.ocurrido_en + interval '15 minutes',
       'Salida confirmada con su jefe; el celular se quedó sin batería', '00000000-0000-4000-8000-0000000000b2'
  FROM checadas c JOIN checadas_anuladas a ON a.checada_id = c.id
 WHERE c.trabajador_id = '00000000-0000-4000-8000-0000000000d3';

-- periodo de la semana pasada, cerrado; Ana aceptó y Sofía objetó
INSERT INTO periodos(id, empresa_id, nombre, inicio, fin)
SELECT '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-0000000000a1',
       'Semana del ' || to_char(d - 6, 'DD/MM') || ' al ' || to_char(d - 1, 'DD/MM'), d - 6, d - 1
  FROM (SELECT (now() AT TIME ZONE 'America/Mexico_City')::date AS d) x;
SELECT cerrar_periodo('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-0000000000b2');
UPDATE periodo_trabajadores SET respuesta = 'ACEPTADO', respondido_en = now()
 WHERE trabajador_id = '00000000-0000-4000-8000-0000000000d1';
UPDATE periodo_trabajadores SET respuesta = 'OBJETADO', respondido_en = now(),
       comentario = 'El jueves salí a las 19:00 por inventario y no aparece'
 WHERE trabajador_id = '00000000-0000-4000-8000-0000000000d3';

-- -----------------------------------------------------------------------------
-- Hoy, "en vivo" (relativo a la hora actual)
-- -----------------------------------------------------------------------------
CREATE FUNCTION pg_temp.hoy(minutos int) RETURNS timestamptz LANGUAGE sql AS $$
  SELECT GREATEST(now() - make_interval(mins => minutos),
                  ((now() AT TIME ZONE 'America/Mexico_City')::date)::timestamp AT TIME ZONE 'America/Mexico_City'
                    + make_interval(mins => 1))
$$;
SELECT pg_temp.checar('00000000-0000-4000-8000-0000000000d1', 'ENTRADA', pg_temp.hoy(190));
SELECT pg_temp.checar('00000000-0000-4000-8000-0000000000d4', 'ENTRADA', pg_temp.hoy(250));
SELECT pg_temp.checar('00000000-0000-4000-8000-0000000000d5', 'ENTRADA', pg_temp.hoy(245));
SELECT pg_temp.checar('00000000-0000-4000-8000-0000000000d5', 'INICIO_DESCANSO', pg_temp.hoy(20));
SELECT pg_temp.checar('00000000-0000-4000-8000-0000000000d2', 'ENTRADA', pg_temp.hoy(170), 20.6000, -100.3899);  -- fuera de zona
SELECT pg_temp.checar('00000000-0000-4000-8000-0000000000d3', 'ENTRADA', pg_temp.hoy(120));
SELECT pg_temp.checar('00000000-0000-4000-8000-0000000000e1', 'ENTRADA', pg_temp.hoy(200));
SELECT pg_temp.checar('00000000-0000-4000-8000-0000000000e3', 'ENTRADA', pg_temp.hoy(180));
SELECT pg_temp.checar('00000000-0000-4000-8000-0000000000e4', 'ENTRADA', pg_temp.hoy(175));

COMMIT;
