-- =============================================================================
-- Checador digital (asistencia) por empresa.
--
--   * Cada empresa (P3 y las demás del grupo) lleva su propio registro: todas
--     las tablas llevan empresa_id y quedan bajo Row Level Security, igual que
--     obras o requisiciones. Una persona que opera varias empresas tiene un
--     usuario por empresa (mismo correo) con sus propios roles; la API emite un
--     token por empresa y permite cambiar de una a otra.
--   * Las checadas son INMUTABLES: no se editan ni se borran. Un error se
--     corrige anulando (con motivo) y capturando una checada de supervisor.
--   * Las reglas (geocerca, secuencia entrada → descanso → salida, periodo
--     cerrado) viven en la base para que apliquen igual desde el celular, el
--     kiosco, la sincronización sin señal o un script.
-- =============================================================================
SET search_path = oc, public;

-- Roles nuevos de alcance empresa:
--   RH      supervisa asistencia, corrige checadas y cierra periodos
--   KIOSCO  dispositivo compartido (tableta en recepción) que checa por número + PIN
ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS 'RH';
ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS 'KIOSCO';

-- -----------------------------------------------------------------------------
-- Empresas: clave corta (P3, …) y zona horaria (define el "día" de cada checada)
-- -----------------------------------------------------------------------------
ALTER TABLE empresas
  ADD COLUMN clave text UNIQUE,
  ADD COLUMN zona_horaria text NOT NULL DEFAULT 'America/Mexico_City';

-- Con varias empresas por persona, cada una sólo debe verse a sí misma.
ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_empresas ON empresas USING (id = current_setting('oc.empresa_id', true)::uuid);

-- Para poder referenciar (empresa_id, usuario_id) y garantizar que el usuario es de la misma empresa
ALTER TABLE usuarios ADD CONSTRAINT usuarios_empresa_id_id_key UNIQUE (empresa_id, id);

CREATE TYPE modalidad_checada AS ENUM ('LUGAR_FIJO', 'DESDE_CASA', 'MOVIL', 'KIOSCO');
CREATE TYPE tipo_checada AS ENUM ('ENTRADA', 'INICIO_DESCANSO', 'FIN_DESCANSO', 'SALIDA');
CREATE TYPE medio_checada AS ENUM ('CELULAR', 'KIOSCO', 'SUPERVISOR');
CREATE TYPE estado_periodo AS ENUM ('ABIERTO', 'CERRADO');

-- -----------------------------------------------------------------------------
-- Catálogos
-- -----------------------------------------------------------------------------
-- Lugar donde se checa: oficina, sucursal, almacén u obra (con geocerca).
CREATE TABLE centros_trabajo (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  clave       text NOT NULL,
  nombre      text NOT NULL,
  obra_id     uuid,
  lat         numeric(9,6),
  lng         numeric(9,6),
  radio_m     integer NOT NULL DEFAULT 150 CHECK (radio_m BETWEEN 10 AND 5000),
  activo      boolean NOT NULL DEFAULT true,
  UNIQUE (empresa_id, clave),
  UNIQUE (empresa_id, id),
  FOREIGN KEY (empresa_id, obra_id) REFERENCES obras(empresa_id, id),
  CHECK ((lat IS NULL) = (lng IS NULL))
);

-- La persona que checa. No necesita ser usuario del sistema: en kiosco basta
-- número + PIN. Si checa desde su celular, se liga a su usuario.
CREATE TABLE trabajadores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresas(id),
  numero        text NOT NULL,                       -- "014": único dentro de la empresa
  nombre        text NOT NULL,
  usuario_id    uuid UNIQUE,
  centro_id     uuid,                                -- centro habitual
  modalidades   modalidad_checada[] NOT NULL DEFAULT '{LUGAR_FIJO}' CHECK (cardinality(modalidades) > 0),
  jornada_min   integer NOT NULL DEFAULT 480 CHECK (jornada_min BETWEEN 60 AND 1440),
  pin_hash      text,                                -- crypt() bcrypt; nunca el PIN en claro
  intentos_pin  integer NOT NULL DEFAULT 0,
  bloqueado_hasta timestamptz,
  activo        boolean NOT NULL DEFAULT true,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, numero),
  UNIQUE (empresa_id, id),
  FOREIGN KEY (empresa_id, usuario_id) REFERENCES usuarios(empresa_id, id),
  FOREIGN KEY (empresa_id, centro_id) REFERENCES centros_trabajo(empresa_id, id)
);

-- -----------------------------------------------------------------------------
-- Checadas (libro de asistencia, sólo inserción)
-- -----------------------------------------------------------------------------
CREATE TABLE checadas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id),
  trabajador_id  uuid NOT NULL,
  tipo           tipo_checada NOT NULL,
  medio          medio_checada NOT NULL,
  modalidad      modalidad_checada,                  -- NULL sólo en capturas de supervisor
  ocurrido_en    timestamptz NOT NULL,               -- hora del dispositivo (puede llegar tarde si no había señal)
  recibido_en    timestamptz NOT NULL DEFAULT now(), -- hora del servidor
  fecha          date NOT NULL,                      -- día local de la empresa (lo fija el trigger)
  centro_id      uuid,
  lat            numeric(9,6),
  lng            numeric(9,6),
  precision_m    numeric(8,1),
  distancia_m    integer,                            -- al centro, si aplica geocerca
  incidencias    text[] NOT NULL DEFAULT '{}',       -- FUERA_DE_ZONA · SIN_UBICACION · SECUENCIA
  nota           text,
  client_uuid    uuid UNIQUE,                        -- idempotencia para envíos sin señal
  registrado_por uuid NOT NULL REFERENCES usuarios(id),
  FOREIGN KEY (empresa_id, trabajador_id) REFERENCES trabajadores(empresa_id, id),
  FOREIGN KEY (empresa_id, centro_id) REFERENCES centros_trabajo(empresa_id, id),
  CONSTRAINT checada_con_modalidad CHECK (medio = 'SUPERVISOR' OR modalidad IS NOT NULL),
  CONSTRAINT checada_supervisor_con_motivo CHECK (medio <> 'SUPERVISOR' OR length(trim(COALESCE(nota, ''))) >= 5),
  CONSTRAINT checada_kiosco_coherente CHECK ((medio = 'KIOSCO') = (modalidad IS NOT DISTINCT FROM 'KIOSCO'))
);
CREATE INDEX ix_checadas_trabajador ON checadas (trabajador_id, ocurrido_en);
CREATE INDEX ix_checadas_fecha ON checadas (empresa_id, fecha);

CREATE TABLE checadas_anuladas (
  checada_id   uuid PRIMARY KEY REFERENCES checadas(id),
  empresa_id   uuid NOT NULL REFERENCES empresas(id),
  motivo       text NOT NULL CHECK (length(trim(motivo)) >= 5),
  anulada_por  uuid NOT NULL REFERENCES usuarios(id),
  anulada_en   timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Periodos (quincena / semana) con cierre y aceptación por trabajador
-- -----------------------------------------------------------------------------
CREATE TABLE periodos_asistencia (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  nombre      text NOT NULL,
  inicio      date NOT NULL,
  fin         date NOT NULL,
  estado      estado_periodo NOT NULL DEFAULT 'ABIERTO',
  cerrado_en  timestamptz,
  cerrado_por uuid REFERENCES usuarios(id),
  CHECK (fin >= inicio AND fin - inicio <= 62),
  CHECK ((estado = 'CERRADO') = (cerrado_en IS NOT NULL)),
  UNIQUE (empresa_id, inicio)
);

-- Foto del cierre: lo que cada trabajador acepta (u objeta) queda congelado.
CREATE TABLE periodo_trabajadores (
  periodo_id         uuid NOT NULL REFERENCES periodos_asistencia(id),
  trabajador_id      uuid NOT NULL REFERENCES trabajadores(id),
  empresa_id         uuid NOT NULL REFERENCES empresas(id),
  minutos_trabajados integer NOT NULL,
  dias_trabajados    integer NOT NULL,
  incidencias        integer NOT NULL,
  correcciones       integer NOT NULL,
  jornadas_abiertas  integer NOT NULL,     -- entradas sin salida
  respuesta          text CHECK (respuesta IN ('ACEPTADO', 'OBJETADO')),
  comentario         text,
  respondido_en      timestamptz,
  PRIMARY KEY (periodo_id, trabajador_id),
  CHECK ((respuesta IS NULL) = (respondido_en IS NULL)),
  CONSTRAINT objecion_con_comentario CHECK (respuesta IS DISTINCT FROM 'OBJETADO' OR length(trim(COALESCE(comentario, ''))) >= 5)
);

-- -----------------------------------------------------------------------------
-- Funciones y reglas
-- -----------------------------------------------------------------------------
/** Distancia en metros entre dos puntos (haversine; suficiente para geocercas). */
CREATE FUNCTION distancia_m(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
RETURNS double precision LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT 2 * 6371000 * asin(sqrt(
    power(sin(radians((lat2 - lat1)::float8) / 2), 2) +
    cos(radians(lat1::float8)) * cos(radians(lat2::float8)) * power(sin(radians((lng2 - lng1)::float8) / 2), 2)))
$$;

/** Qué checada puede seguir a otra. La app de campo replica esto en contracts/checador.ts. */
CREATE FUNCTION siguientes_checada(ultimo tipo_checada)
RETURNS tipo_checada[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE ultimo
    WHEN 'ENTRADA'         THEN ARRAY['INICIO_DESCANSO', 'SALIDA']::tipo_checada[]
    WHEN 'INICIO_DESCANSO' THEN ARRAY['FIN_DESCANSO']::tipo_checada[]
    WHEN 'FIN_DESCANSO'    THEN ARRAY['INICIO_DESCANSO', 'SALIDA']::tipo_checada[]
    ELSE ARRAY['ENTRADA']::tipo_checada[]   -- sin registro previo o después de SALIDA
  END
$$;

CREATE FUNCTION periodo_cerrado(p_empresa uuid, p_fecha date) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM periodos_asistencia
                  WHERE empresa_id = p_empresa AND estado = 'CERRADO' AND p_fecha BETWEEN inicio AND fin)
$$;

CREATE FUNCTION trg_checada_reglas() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  t   trabajadores;
  ct  centros_trabajo;
  tz  text;
  ult_tipo tipo_checada;
  ult_en   timestamptz;
  inc text[] := '{}';
BEGIN
  -- serializa las checadas de un mismo trabajador (dos dispositivos a la vez)
  SELECT * INTO t FROM trabajadores WHERE id = NEW.trabajador_id AND empresa_id = NEW.empresa_id FOR UPDATE;
  IF NOT FOUND OR NOT t.activo THEN
    RAISE EXCEPTION 'Trabajador inactivo o inexistente';
  END IF;

  SELECT zona_horaria INTO tz FROM empresas WHERE id = NEW.empresa_id;
  NEW.fecha := (NEW.ocurrido_en AT TIME ZONE tz)::date;
  NEW.recibido_en := now();

  IF NEW.ocurrido_en > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'La hora de la checada está en el futuro; revise el reloj del dispositivo';
  END IF;
  IF periodo_cerrado(NEW.empresa_id, NEW.fecha) THEN
    RAISE EXCEPTION 'El periodo que incluye el % ya está cerrado', NEW.fecha;
  END IF;

  IF NEW.medio <> 'SUPERVISOR' THEN
    IF NOT (NEW.modalidad = ANY (t.modalidades)) THEN
      RAISE EXCEPTION 'El trabajador % no tiene habilitada la modalidad %', t.numero, NEW.modalidad;
    END IF;
    IF NEW.ocurrido_en < now() - interval '7 days' THEN
      RAISE EXCEPTION 'Checada con más de 7 días de antigüedad; debe capturarla un supervisor';
    END IF;

    IF NEW.modalidad IN ('LUGAR_FIJO', 'KIOSCO') THEN
      NEW.centro_id := COALESCE(NEW.centro_id, t.centro_id);
      IF NEW.centro_id IS NULL THEN
        RAISE EXCEPTION 'La modalidad % requiere un centro de trabajo', NEW.modalidad;
      END IF;
    END IF;

    IF NEW.modalidad = 'LUGAR_FIJO' THEN
      SELECT * INTO ct FROM centros_trabajo WHERE id = NEW.centro_id;
      IF NEW.lat IS NULL THEN
        inc := inc || 'SIN_UBICACION'::text;
      ELSIF ct.lat IS NOT NULL THEN
        NEW.distancia_m := round(distancia_m(NEW.lat, NEW.lng, ct.lat, ct.lng));
        -- se tolera la imprecisión del GPS (hasta 100 m) antes de marcar fuera de zona
        IF NEW.distancia_m > ct.radio_m + LEAST(COALESCE(NEW.precision_m, 0), 100) THEN
          inc := inc || 'FUERA_DE_ZONA'::text;
        END IF;
      END IF;
    ELSIF NEW.modalidad = 'MOVIL' AND NEW.lat IS NULL THEN
      inc := inc || 'SIN_UBICACION'::text;
    END IF;
  END IF;

  -- secuencia: se compara con la checada vigente inmediata anterior
  SELECT c.tipo, c.ocurrido_en INTO ult_tipo, ult_en
    FROM checadas c
   WHERE c.trabajador_id = NEW.trabajador_id AND c.ocurrido_en <= NEW.ocurrido_en
     AND NOT EXISTS (SELECT 1 FROM checadas_anuladas a WHERE a.checada_id = c.id)
   ORDER BY c.ocurrido_en DESC LIMIT 1;
  IF NEW.medio <> 'SUPERVISOR' AND ult_tipo = NEW.tipo AND NEW.ocurrido_en - ult_en < interval '2 minutes' THEN
    RAISE EXCEPTION 'Checada repetida: ya se registró % a las %', lower(replace(NEW.tipo::text, '_', ' ')),
      to_char(ult_en AT TIME ZONE tz, 'HH24:MI');
  END IF;
  -- más de 16 h sin movimiento: empieza otra jornada (la anterior queda abierta)
  IF NEW.ocurrido_en - ult_en > interval '16 hours' THEN ult_tipo := NULL; END IF;
  IF NOT (NEW.tipo = ANY (siguientes_checada(ult_tipo))) THEN
    inc := inc || 'SECUENCIA'::text;
  END IF;

  NEW.incidencias := inc;
  RETURN NEW;
END $$;
CREATE TRIGGER checada_reglas BEFORE INSERT ON checadas FOR EACH ROW EXECUTE FUNCTION trg_checada_reglas();

CREATE FUNCTION trg_anulacion_reglas() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c checadas;
BEGIN
  SELECT * INTO c FROM checadas WHERE id = NEW.checada_id;
  IF NOT FOUND OR c.empresa_id <> NEW.empresa_id THEN RAISE EXCEPTION 'Checada no encontrada'; END IF;
  IF periodo_cerrado(c.empresa_id, c.fecha) THEN
    RAISE EXCEPTION 'El periodo que incluye el % ya está cerrado', c.fecha;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER anulacion_reglas BEFORE INSERT ON checadas_anuladas FOR EACH ROW EXECUTE FUNCTION trg_anulacion_reglas();

CREATE FUNCTION trg_periodo_reglas() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'ABIERTO' THEN RAISE EXCEPTION 'Un periodo nace abierto'; END IF;
    IF EXISTS (SELECT 1 FROM periodos_asistencia p WHERE p.empresa_id = NEW.empresa_id
                 AND daterange(p.inicio, p.fin, '[]') && daterange(NEW.inicio, NEW.fin, '[]')) THEN
      RAISE EXCEPTION 'El periodo se traslapa con otro de la empresa';
    END IF;
  ELSE
    IF OLD.estado = 'CERRADO' THEN RAISE EXCEPTION 'El periodo % ya está cerrado', OLD.nombre; END IF;
    IF (NEW.inicio, NEW.fin, NEW.empresa_id) IS DISTINCT FROM (OLD.inicio, OLD.fin, OLD.empresa_id) THEN
      RAISE EXCEPTION 'Las fechas de un periodo no se modifican';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER periodo_reglas BEFORE INSERT OR UPDATE ON periodos_asistencia
  FOR EACH ROW EXECUTE FUNCTION trg_periodo_reglas();

CREATE FUNCTION trg_respuesta_periodo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.respuesta IS NOT NULL THEN RAISE EXCEPTION 'El trabajador ya respondió este periodo'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER respuesta_periodo BEFORE UPDATE ON periodo_trabajadores
  FOR EACH ROW EXECUTE FUNCTION trg_respuesta_periodo();

-- -----------------------------------------------------------------------------
-- Vistas (security_invoker: respetan el RLS de quien consulta)
-- -----------------------------------------------------------------------------
CREATE VIEW v_checadas_vigentes WITH (security_invoker = true) AS
SELECT c.* FROM checadas c
 WHERE NOT EXISTS (SELECT 1 FROM checadas_anuladas a WHERE a.checada_id = c.id);

-- Tramos efectivamente trabajados: de ENTRADA / FIN_DESCANSO a la siguiente
-- checada si es INICIO_DESCANSO / SALIDA. Una entrada sin salida no suma horas.
CREATE VIEW v_tramos_trabajo WITH (security_invoker = true) AS
WITH s AS (
  SELECT c.empresa_id, c.trabajador_id, c.fecha, c.tipo, c.ocurrido_en,
         lead(c.tipo)        OVER w AS sig_tipo,
         lead(c.ocurrido_en) OVER w AS sig_en
    FROM v_checadas_vigentes c
  WINDOW w AS (PARTITION BY c.trabajador_id ORDER BY c.ocurrido_en)
)
SELECT empresa_id, trabajador_id, fecha, ocurrido_en AS inicio, sig_en AS fin,
       (extract(epoch FROM sig_en - ocurrido_en) / 60)::int AS minutos
  FROM s
 WHERE tipo IN ('ENTRADA', 'FIN_DESCANSO') AND sig_tipo IN ('INICIO_DESCANSO', 'SALIDA')
   AND sig_en - ocurrido_en <= interval '16 hours';

-- Entradas que no tienen salida en las 16 h siguientes
CREATE VIEW v_jornadas_abiertas WITH (security_invoker = true) AS
SELECT c.empresa_id, c.trabajador_id, c.fecha, c.id AS checada_id, c.ocurrido_en
  FROM v_checadas_vigentes c
 WHERE c.tipo = 'ENTRADA'
   AND NOT EXISTS (SELECT 1 FROM v_checadas_vigentes s
                    WHERE s.trabajador_id = c.trabajador_id AND s.tipo = 'SALIDA'
                      AND s.ocurrido_en > c.ocurrido_en AND s.ocurrido_en <= c.ocurrido_en + interval '16 hours');

/** Cierra el periodo y congela, por trabajador, horas e incidencias para su aceptación. */
CREATE FUNCTION cerrar_periodo(p_periodo uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  p periodos_asistencia;
  n integer;
BEGIN
  SELECT * INTO p FROM periodos_asistencia WHERE id = p_periodo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Periodo no encontrado'; END IF;
  IF p.estado = 'CERRADO' THEN RAISE EXCEPTION 'El periodo % ya está cerrado', p.nombre; END IF;
  IF p.fin >= (now() AT TIME ZONE (SELECT zona_horaria FROM empresas WHERE id = p.empresa_id))::date THEN
    RAISE EXCEPTION 'El periodo % aún no termina (fin %)', p.nombre, p.fin;
  END IF;

  INSERT INTO periodo_trabajadores(periodo_id, trabajador_id, empresa_id, minutos_trabajados, dias_trabajados,
                                   incidencias, correcciones, jornadas_abiertas)
  SELECT p.id, t.id, p.empresa_id,
         COALESCE((SELECT sum(minutos) FROM v_tramos_trabajo v
                    WHERE v.trabajador_id = t.id AND v.fecha BETWEEN p.inicio AND p.fin), 0),
         (SELECT count(DISTINCT v.fecha) FROM v_tramos_trabajo v
           WHERE v.trabajador_id = t.id AND v.fecha BETWEEN p.inicio AND p.fin),
         (SELECT count(*) FROM v_checadas_vigentes c
           WHERE c.trabajador_id = t.id AND c.fecha BETWEEN p.inicio AND p.fin AND cardinality(c.incidencias) > 0),
         (SELECT count(*) FROM checadas c
           WHERE c.trabajador_id = t.id AND c.fecha BETWEEN p.inicio AND p.fin AND c.medio = 'SUPERVISOR'),
         (SELECT count(*) FROM v_jornadas_abiertas j
           WHERE j.trabajador_id = t.id AND j.fecha BETWEEN p.inicio AND p.fin)
    FROM trabajadores t
   WHERE t.empresa_id = p.empresa_id
     AND (t.activo OR EXISTS (SELECT 1 FROM checadas c WHERE c.trabajador_id = t.id
                                AND c.fecha BETWEEN p.inicio AND p.fin));
  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE periodos_asistencia
     SET estado = 'CERRADO', cerrado_en = now(), cerrado_por = current_setting('oc.usuario_id', true)::uuid
   WHERE id = p.id;
  RETURN n;
END $$;

-- -----------------------------------------------------------------------------
-- Seguridad: RLS por empresa y permisos del rol de aplicación
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['centros_trabajo', 'trabajadores', 'checadas', 'checadas_anuladas',
                           'periodos_asistencia', 'periodo_trabajadores']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_%1$s ON %1$I
                     USING (empresa_id = current_setting('oc.empresa_id', true)::uuid)$p$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON centros_trabajo, trabajadores, periodos_asistencia TO oc_app;
-- libro de asistencia: sólo inserción
GRANT SELECT, INSERT ON checadas, checadas_anuladas, periodo_trabajadores TO oc_app;
-- el trabajador sólo puede escribir su respuesta
GRANT UPDATE (respuesta, comentario, respondido_en) ON periodo_trabajadores TO oc_app;
GRANT SELECT ON v_checadas_vigentes, v_tramos_trabajo, v_jornadas_abiertas TO oc_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA oc TO oc_app;
