-- =============================================================================
-- Checador — esquema base.
--
-- Multi-empresa: un grupo tiene varias empresas (P3 y las demás). Cada empresa
-- lleva su propio registro: toda tabla de negocio tiene empresa_id y está bajo
-- Row Level Security. El servidor abre cada transacción con el rol
-- checador_app (sin BYPASSRLS) y fija app.empresa_id; así una consulta mal
-- escrita no puede devolver datos de otra empresa.
--
-- Identidad: una CUENTA por persona (correo + contraseña) y una MEMBRESÍA por
-- cada empresa a la que tiene acceso, con su rol en esa empresa.
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS checador;
SET search_path = checador, public;

CREATE TYPE rol_empresa AS ENUM ('ADMIN', 'RH', 'SUPERVISOR', 'TRABAJADOR');
CREATE TYPE modalidad AS ENUM ('LUGAR_FIJO', 'DESDE_CASA', 'MOVIL', 'KIOSCO');
CREATE TYPE tipo_checada AS ENUM ('ENTRADA', 'INICIO_DESCANSO', 'FIN_DESCANSO', 'SALIDA');
CREATE TYPE medio_checada AS ENUM ('CELULAR', 'KIOSCO', 'SUPERVISOR');
CREATE TYPE estado_periodo AS ENUM ('ABIERTO', 'CERRADO');

-- -----------------------------------------------------------------------------
-- Grupo, empresas, cuentas
-- -----------------------------------------------------------------------------
CREATE TABLE grupos (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre  text NOT NULL
);

CREATE TABLE empresas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id      uuid REFERENCES grupos(id),
  clave         text NOT NULL UNIQUE CHECK (clave ~ '^[A-Z0-9-]{1,12}$'),
  nombre        text NOT NULL,
  rfc           text,
  zona_horaria  text NOT NULL DEFAULT 'America/Mexico_City',
  tolerancia_min integer NOT NULL DEFAULT 10 CHECK (tolerancia_min BETWEEN 0 AND 120),
  creada_en     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cuentas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL,
  nombre         text NOT NULL,
  password_hash  text NOT NULL,
  activa         boolean NOT NULL DEFAULT true,
  creada_en      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_cuentas_email ON cuentas (lower(email));

-- -----------------------------------------------------------------------------
-- Catálogos por empresa
-- -----------------------------------------------------------------------------
CREATE TABLE centros (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  clave       text NOT NULL,
  nombre      text NOT NULL,
  direccion   text,
  lat         numeric(9,6),
  lng         numeric(9,6),
  radio_m     integer NOT NULL DEFAULT 150 CHECK (radio_m BETWEEN 10 AND 5000),
  activo      boolean NOT NULL DEFAULT true,
  UNIQUE (empresa_id, clave),
  UNIQUE (empresa_id, id),
  CHECK ((lat IS NULL) = (lng IS NULL))
);

CREATE TABLE trabajadores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id),
  numero          text NOT NULL CHECK (numero ~ '^[0-9A-Za-z-]{1,12}$'),
  nombre          text NOT NULL,
  puesto          text,
  centro_id       uuid,
  modalidades     modalidad[] NOT NULL DEFAULT '{LUGAR_FIJO}' CHECK (cardinality(modalidades) > 0),
  hora_entrada    time,                         -- para marcar RETARDO; NULL = horario libre
  jornada_min     integer NOT NULL DEFAULT 480 CHECK (jornada_min BETWEEN 60 AND 1440),
  pin_hash        text,                         -- crypt() bcrypt; el PIN nunca se guarda en claro
  intentos_pin    integer NOT NULL DEFAULT 0,
  bloqueado_hasta timestamptz,
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, numero),
  UNIQUE (empresa_id, id),
  FOREIGN KEY (empresa_id, centro_id) REFERENCES centros(empresa_id, id)
);

-- Acceso de una cuenta a una empresa. Un trabajador que checa desde su celular
-- tiene membresía TRABAJADOR ligada a su ficha de trabajador.
CREATE TABLE membresias (
  cuenta_id      uuid NOT NULL REFERENCES cuentas(id),
  empresa_id     uuid NOT NULL REFERENCES empresas(id),
  rol            rol_empresa NOT NULL,
  trabajador_id  uuid,
  activa         boolean NOT NULL DEFAULT true,
  PRIMARY KEY (cuenta_id, empresa_id),
  UNIQUE (trabajador_id),
  FOREIGN KEY (empresa_id, trabajador_id) REFERENCES trabajadores(empresa_id, id),
  CONSTRAINT trabajador_con_ficha CHECK (rol <> 'TRABAJADOR' OR trabajador_id IS NOT NULL)
);

-- Tabletas de kiosco: se activan por RH en un centro y reciben un token propio.
CREATE TABLE dispositivos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL REFERENCES empresas(id),
  centro_id    uuid NOT NULL,
  nombre       text NOT NULL,
  token_hash   text NOT NULL UNIQUE,            -- sha256 del token; el token sólo lo tiene la tableta
  creado_por   uuid NOT NULL REFERENCES cuentas(id),
  creado_en    timestamptz NOT NULL DEFAULT now(),
  ultimo_uso   timestamptz,
  revocado_en  timestamptz,
  FOREIGN KEY (empresa_id, centro_id) REFERENCES centros(empresa_id, id)
);

-- -----------------------------------------------------------------------------
-- Checadas: libro de asistencia de sólo inserción
-- -----------------------------------------------------------------------------
CREATE TABLE checadas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id),
  trabajador_id   uuid NOT NULL,
  tipo            tipo_checada NOT NULL,
  medio           medio_checada NOT NULL,
  modalidad       modalidad,                    -- NULL sólo en capturas de supervisor
  ocurrido_en     timestamptz NOT NULL,         -- hora en que se checó (puede llegar tarde sin señal)
  recibido_en     timestamptz NOT NULL DEFAULT now(),
  fecha           date NOT NULL,                -- día local de la empresa (lo fija el trigger)
  centro_id       uuid,
  lat             numeric(9,6),
  lng             numeric(9,6),
  precision_m     numeric(8,1),
  distancia_m     integer,
  incidencias     text[] NOT NULL DEFAULT '{}', -- FUERA_DE_ZONA · SIN_UBICACION · SECUENCIA · RETARDO
  nota            text,
  client_uuid     uuid UNIQUE,                  -- idempotencia de envíos sin señal
  cuenta_id       uuid REFERENCES cuentas(id),  -- quién la registró (celular o supervisor)
  dispositivo_id  uuid REFERENCES dispositivos(id),
  FOREIGN KEY (empresa_id, trabajador_id) REFERENCES trabajadores(empresa_id, id),
  FOREIGN KEY (empresa_id, centro_id) REFERENCES centros(empresa_id, id),
  CONSTRAINT checada_con_modalidad CHECK (medio = 'SUPERVISOR' OR modalidad IS NOT NULL),
  CONSTRAINT checada_supervisor_con_motivo CHECK (medio <> 'SUPERVISOR' OR length(trim(COALESCE(nota, ''))) >= 5),
  CONSTRAINT checada_kiosco_coherente CHECK ((medio = 'KIOSCO') = (dispositivo_id IS NOT NULL)
                                             AND (medio = 'KIOSCO') = (modalidad IS NOT DISTINCT FROM 'KIOSCO')),
  CONSTRAINT checada_con_autor CHECK (cuenta_id IS NOT NULL OR dispositivo_id IS NOT NULL)
);
CREATE INDEX ix_checadas_trabajador ON checadas (trabajador_id, ocurrido_en);
CREATE INDEX ix_checadas_fecha ON checadas (empresa_id, fecha);

CREATE TABLE checadas_anuladas (
  checada_id  uuid PRIMARY KEY REFERENCES checadas(id),
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  motivo      text NOT NULL CHECK (length(trim(motivo)) >= 5),
  anulada_por uuid NOT NULL REFERENCES cuentas(id),
  anulada_en  timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Periodos (quincena, semana) con cierre y aceptación por trabajador
-- -----------------------------------------------------------------------------
CREATE TABLE periodos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  nombre      text NOT NULL,
  inicio      date NOT NULL,
  fin         date NOT NULL,
  estado      estado_periodo NOT NULL DEFAULT 'ABIERTO',
  cerrado_en  timestamptz,
  cerrado_por uuid REFERENCES cuentas(id),
  CHECK (fin >= inicio AND fin - inicio <= 62),
  CHECK ((estado = 'CERRADO') = (cerrado_en IS NOT NULL)),
  UNIQUE (empresa_id, inicio)
);

CREATE TABLE periodo_trabajadores (
  periodo_id         uuid NOT NULL REFERENCES periodos(id),
  trabajador_id      uuid NOT NULL REFERENCES trabajadores(id),
  empresa_id         uuid NOT NULL REFERENCES empresas(id),
  minutos_trabajados integer NOT NULL,
  dias_trabajados    integer NOT NULL,
  retardos           integer NOT NULL,
  incidencias        integer NOT NULL,
  correcciones       integer NOT NULL,
  jornadas_abiertas  integer NOT NULL,
  respuesta          text CHECK (respuesta IN ('ACEPTADO', 'OBJETADO')),
  comentario         text,
  respondido_en      timestamptz,
  PRIMARY KEY (periodo_id, trabajador_id),
  CHECK ((respuesta IS NULL) = (respondido_en IS NULL)),
  CONSTRAINT objecion_con_comentario CHECK (respuesta IS DISTINCT FROM 'OBJETADO'
                                            OR length(trim(COALESCE(comentario, ''))) >= 5)
);

-- -----------------------------------------------------------------------------
-- Reglas
-- -----------------------------------------------------------------------------
/** Distancia en metros (haversine). */
CREATE FUNCTION distancia_m(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
RETURNS double precision LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT 2 * 6371000 * asin(sqrt(
    power(sin(radians((lat2 - lat1)::float8) / 2), 2) +
    cos(radians(lat1::float8)) * cos(radians(lat2::float8)) * power(sin(radians((lng2 - lng1)::float8) / 2), 2)))
$$;

/** Qué checada puede seguir a otra (el cliente replica esto en web/src/jornada.ts). */
CREATE FUNCTION siguientes(ultimo tipo_checada) RETURNS tipo_checada[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE ultimo
    WHEN 'ENTRADA'         THEN ARRAY['INICIO_DESCANSO', 'SALIDA']::tipo_checada[]
    WHEN 'INICIO_DESCANSO' THEN ARRAY['FIN_DESCANSO']::tipo_checada[]
    WHEN 'FIN_DESCANSO'    THEN ARRAY['INICIO_DESCANSO', 'SALIDA']::tipo_checada[]
    ELSE ARRAY['ENTRADA']::tipo_checada[]
  END
$$;

CREATE FUNCTION periodo_cerrado(p_empresa uuid, p_fecha date) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM periodos
                  WHERE empresa_id = p_empresa AND estado = 'CERRADO' AND p_fecha BETWEEN inicio AND fin)
$$;

/** Última checada vigente del trabajador hasta `hasta` (dentro de 16 h), o NULL. */
CREATE FUNCTION ultima_checada(p_trabajador uuid, hasta timestamptz) RETURNS tipo_checada
LANGUAGE sql STABLE AS $$
  SELECT c.tipo FROM checadas c
   WHERE c.trabajador_id = p_trabajador AND c.ocurrido_en <= hasta AND c.ocurrido_en > hasta - interval '16 hours'
     AND NOT EXISTS (SELECT 1 FROM checadas_anuladas a WHERE a.checada_id = c.id)
   ORDER BY c.ocurrido_en DESC LIMIT 1
$$;

CREATE FUNCTION trg_checada() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  t    trabajadores;
  ct   centros;
  e    empresas;
  prev tipo_checada;
  prev_en timestamptz;
  inc  text[] := '{}';
BEGIN
  -- serializa checadas simultáneas del mismo trabajador
  SELECT * INTO t FROM trabajadores WHERE id = NEW.trabajador_id AND empresa_id = NEW.empresa_id FOR UPDATE;
  IF NOT FOUND OR NOT t.activo THEN RAISE EXCEPTION 'Trabajador inactivo o inexistente'; END IF;
  SELECT * INTO e FROM empresas WHERE id = NEW.empresa_id;

  NEW.recibido_en := now();
  NEW.fecha := (NEW.ocurrido_en AT TIME ZONE e.zona_horaria)::date;

  IF NEW.ocurrido_en > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'La hora de la checada está en el futuro; revise el reloj del dispositivo';
  END IF;
  IF periodo_cerrado(NEW.empresa_id, NEW.fecha) THEN
    RAISE EXCEPTION 'El periodo que incluye el % ya está cerrado', to_char(NEW.fecha, 'DD/MM/YYYY');
  END IF;

  IF NEW.medio <> 'SUPERVISOR' THEN
    IF NOT (NEW.modalidad = ANY (t.modalidades)) THEN
      RAISE EXCEPTION '% no tiene habilitado checar en modalidad %', t.nombre,
        CASE NEW.modalidad WHEN 'LUGAR_FIJO' THEN 'lugar fijo' WHEN 'DESDE_CASA' THEN 'desde casa'
                           WHEN 'MOVIL' THEN 'móvil' ELSE 'kiosco' END;
    END IF;
    IF NEW.ocurrido_en < now() - interval '7 days' THEN
      RAISE EXCEPTION 'Checada con más de 7 días de antigüedad; debe capturarla RH';
    END IF;
    IF NEW.modalidad IN ('LUGAR_FIJO', 'KIOSCO') THEN
      NEW.centro_id := COALESCE(NEW.centro_id, t.centro_id);
      IF NEW.centro_id IS NULL THEN RAISE EXCEPTION '% no tiene centro de trabajo asignado', t.nombre; END IF;
    END IF;
    IF NEW.modalidad = 'LUGAR_FIJO' THEN
      SELECT * INTO ct FROM centros WHERE id = NEW.centro_id;
      IF NEW.lat IS NULL THEN
        inc := inc || 'SIN_UBICACION'::text;
      ELSIF ct.lat IS NOT NULL THEN
        NEW.distancia_m := round(distancia_m(NEW.lat, NEW.lng, ct.lat, ct.lng));
        -- se tolera la imprecisión del GPS (hasta 100 m)
        IF NEW.distancia_m > ct.radio_m + LEAST(COALESCE(NEW.precision_m, 0), 100) THEN
          inc := inc || 'FUERA_DE_ZONA'::text;
        END IF;
      END IF;
    ELSIF NEW.modalidad = 'MOVIL' AND NEW.lat IS NULL THEN
      inc := inc || 'SIN_UBICACION'::text;
    END IF;
  END IF;

  SELECT c.tipo, c.ocurrido_en INTO prev, prev_en FROM checadas c
   WHERE c.trabajador_id = NEW.trabajador_id AND c.ocurrido_en <= NEW.ocurrido_en
     AND NOT EXISTS (SELECT 1 FROM checadas_anuladas a WHERE a.checada_id = c.id)
   ORDER BY c.ocurrido_en DESC LIMIT 1;
  IF NEW.medio <> 'SUPERVISOR' AND prev = NEW.tipo AND NEW.ocurrido_en - prev_en < interval '2 minutes' THEN
    RAISE EXCEPTION 'Ya se registró % a las %', lower(replace(NEW.tipo::text, '_', ' ')),
      to_char(prev_en AT TIME ZONE e.zona_horaria, 'HH24:MI');
  END IF;
  IF NEW.ocurrido_en - prev_en > interval '16 hours' THEN prev := NULL; END IF;  -- jornada nueva
  IF NOT (NEW.tipo = ANY (siguientes(prev))) THEN inc := inc || 'SECUENCIA'::text; END IF;

  -- retardo: primera entrada del día después de la hora de entrada + tolerancia
  IF NEW.tipo = 'ENTRADA' AND t.hora_entrada IS NOT NULL
     AND (NEW.ocurrido_en AT TIME ZONE e.zona_horaria)::time > t.hora_entrada + make_interval(mins => e.tolerancia_min)
     AND NOT EXISTS (SELECT 1 FROM checadas c WHERE c.trabajador_id = NEW.trabajador_id AND c.fecha = NEW.fecha
                       AND c.tipo = 'ENTRADA' AND c.ocurrido_en < NEW.ocurrido_en
                       AND NOT EXISTS (SELECT 1 FROM checadas_anuladas a WHERE a.checada_id = c.id)) THEN
    inc := inc || 'RETARDO'::text;
  END IF;

  NEW.incidencias := inc;
  RETURN NEW;
END $$;
CREATE TRIGGER checada_reglas BEFORE INSERT ON checadas FOR EACH ROW EXECUTE FUNCTION trg_checada();

CREATE FUNCTION trg_anulacion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c checadas;
BEGIN
  SELECT * INTO c FROM checadas WHERE id = NEW.checada_id;
  IF NOT FOUND OR c.empresa_id <> NEW.empresa_id THEN RAISE EXCEPTION 'Checada no encontrada'; END IF;
  IF periodo_cerrado(c.empresa_id, c.fecha) THEN
    RAISE EXCEPTION 'El periodo que incluye el % ya está cerrado', to_char(c.fecha, 'DD/MM/YYYY');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER anulacion_reglas BEFORE INSERT ON checadas_anuladas FOR EACH ROW EXECUTE FUNCTION trg_anulacion();

CREATE FUNCTION trg_periodo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'ABIERTO' THEN RAISE EXCEPTION 'Un periodo nace abierto'; END IF;
    IF EXISTS (SELECT 1 FROM periodos p WHERE p.empresa_id = NEW.empresa_id
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
CREATE TRIGGER periodo_reglas BEFORE INSERT OR UPDATE ON periodos FOR EACH ROW EXECUTE FUNCTION trg_periodo();

CREATE FUNCTION trg_respuesta() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.respuesta IS NOT NULL THEN RAISE EXCEPTION 'Ya respondió este periodo'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER respuesta_unica BEFORE UPDATE ON periodo_trabajadores FOR EACH ROW EXECUTE FUNCTION trg_respuesta();

-- -----------------------------------------------------------------------------
-- Vistas (security_invoker: respetan el RLS de quien consulta)
-- -----------------------------------------------------------------------------
CREATE VIEW v_checadas WITH (security_invoker = true) AS
SELECT c.* FROM checadas c WHERE NOT EXISTS (SELECT 1 FROM checadas_anuladas a WHERE a.checada_id = c.id);

-- Tramos trabajados: de ENTRADA / FIN_DESCANSO a la siguiente INICIO_DESCANSO / SALIDA (≤ 16 h)
CREATE VIEW v_tramos WITH (security_invoker = true) AS
WITH s AS (
  SELECT c.empresa_id, c.trabajador_id, c.fecha, c.tipo, c.ocurrido_en,
         lead(c.tipo) OVER w AS sig_tipo, lead(c.ocurrido_en) OVER w AS sig_en
    FROM v_checadas c WINDOW w AS (PARTITION BY c.trabajador_id ORDER BY c.ocurrido_en)
)
SELECT empresa_id, trabajador_id, fecha, ocurrido_en AS inicio, sig_en AS fin,
       (extract(epoch FROM sig_en - ocurrido_en) / 60)::int AS minutos
  FROM s
 WHERE tipo IN ('ENTRADA', 'FIN_DESCANSO') AND sig_tipo IN ('INICIO_DESCANSO', 'SALIDA')
   AND sig_en - ocurrido_en <= interval '16 hours';

-- Entradas sin salida en las 16 h siguientes
CREATE VIEW v_jornadas_abiertas WITH (security_invoker = true) AS
SELECT c.empresa_id, c.trabajador_id, c.fecha, c.id AS checada_id, c.ocurrido_en
  FROM v_checadas c
 WHERE c.tipo = 'ENTRADA'
   AND NOT EXISTS (SELECT 1 FROM v_checadas s
                    WHERE s.trabajador_id = c.trabajador_id AND s.tipo = 'SALIDA'
                      AND s.ocurrido_en > c.ocurrido_en AND s.ocurrido_en <= c.ocurrido_en + interval '16 hours');

/** Cierra el periodo y congela por trabajador lo que va a aceptar u objetar. */
CREATE FUNCTION cerrar_periodo(p_periodo uuid, p_cuenta uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE p periodos; n integer;
BEGIN
  SELECT * INTO p FROM periodos WHERE id = p_periodo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Periodo no encontrado'; END IF;
  IF p.estado = 'CERRADO' THEN RAISE EXCEPTION 'El periodo % ya está cerrado', p.nombre; END IF;
  IF p.fin >= (now() AT TIME ZONE (SELECT zona_horaria FROM empresas WHERE id = p.empresa_id))::date THEN
    RAISE EXCEPTION 'El periodo % aún no termina (último día %)', p.nombre, to_char(p.fin, 'DD/MM/YYYY');
  END IF;

  INSERT INTO periodo_trabajadores(periodo_id, trabajador_id, empresa_id, minutos_trabajados, dias_trabajados,
                                   retardos, incidencias, correcciones, jornadas_abiertas)
  SELECT p.id, t.id, p.empresa_id,
         COALESCE((SELECT sum(minutos) FROM v_tramos v WHERE v.trabajador_id = t.id AND v.fecha BETWEEN p.inicio AND p.fin), 0),
         (SELECT count(DISTINCT v.fecha) FROM v_tramos v WHERE v.trabajador_id = t.id AND v.fecha BETWEEN p.inicio AND p.fin),
         (SELECT count(*) FROM v_checadas c WHERE c.trabajador_id = t.id AND c.fecha BETWEEN p.inicio AND p.fin
             AND 'RETARDO' = ANY (c.incidencias)),
         (SELECT count(*) FROM v_checadas c WHERE c.trabajador_id = t.id AND c.fecha BETWEEN p.inicio AND p.fin
             AND c.incidencias && ARRAY['FUERA_DE_ZONA', 'SIN_UBICACION', 'SECUENCIA']),
         (SELECT count(*) FROM checadas c WHERE c.trabajador_id = t.id AND c.fecha BETWEEN p.inicio AND p.fin
             AND c.medio = 'SUPERVISOR'),
         (SELECT count(*) FROM v_jornadas_abiertas j WHERE j.trabajador_id = t.id AND j.fecha BETWEEN p.inicio AND p.fin)
    FROM trabajadores t
   WHERE t.empresa_id = p.empresa_id
     AND (t.activo OR EXISTS (SELECT 1 FROM checadas c WHERE c.trabajador_id = t.id AND c.fecha BETWEEN p.inicio AND p.fin));
  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE periodos SET estado = 'CERRADO', cerrado_en = now(), cerrado_por = p_cuenta WHERE id = p.id;
  RETURN n;
END $$;

-- -----------------------------------------------------------------------------
-- Seguridad
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'checador_app') THEN CREATE ROLE checador_app NOLOGIN; END IF;
END $$;
GRANT checador_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA checador TO checador_app;

ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;
CREATE POLICY por_empresa ON empresas USING (id = current_setting('app.empresa_id', true)::uuid);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['centros', 'trabajadores', 'membresias', 'dispositivos', 'checadas', 'checadas_anuladas',
                           'periodos', 'periodo_trabajadores']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY por_empresa ON %I USING (empresa_id = current_setting('app.empresa_id', true)::uuid)$p$, t);
  END LOOP;
END $$;

-- cuentas (contraseñas) y grupos no son accesibles para el rol de aplicación
GRANT SELECT, UPDATE (tolerancia_min, zona_horaria, nombre, rfc) ON empresas TO checador_app;
GRANT SELECT, INSERT, UPDATE ON centros, trabajadores, membresias, dispositivos, periodos TO checador_app;
GRANT SELECT, INSERT ON checadas, checadas_anuladas, periodo_trabajadores TO checador_app;   -- libro: sólo inserción
GRANT UPDATE (respuesta, comentario, respondido_en) ON periodo_trabajadores TO checador_app;
GRANT SELECT ON v_checadas, v_tramos, v_jornadas_abiertas TO checador_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA checador TO checador_app;
