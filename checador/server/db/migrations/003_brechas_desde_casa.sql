-- =============================================================================
-- Cierra las brechas de checar fuera de un centro (desde casa / móvil):
--
--  1. ¿Dónde?   Casa registrada por trabajador (la propone él desde su celular,
--               RH la aprueba viendo el mapa). Fuera de ese radio → FUERA_DE_CASA.
--               Sin casa aprobada → CASA_SIN_APROBAR.
--  2. ¿Cuándo?  Días de home office permitidos por trabajador → DIA_NO_REMOTO.
--               La hora no la decide el reloj del teléfono: la app manda cuándo
--               se checó y cuándo se envió (ambos con el reloj del teléfono) y el
--               servidor usa su propia hora menos esa diferencia. Adelantar o
--               atrasar el reloj no cambia nada. Lo que llega más de 5 min después
--               de checado queda marcado ENVIO_DIFERIDO; pasada la ventana de la
--               empresa (48 h por omisión) se rechaza.
--  3. ¿Quién?   Foto (selfie) obligatoria al checar desde casa o en movimiento;
--               el kiosco también toma foto si la tableta tiene cámara.
--
-- Nada de esto bloquea al trabajador salvo la foto y la ventana: lo dudoso se
-- registra y queda como incidencia para que RH lo revise.
-- =============================================================================
SET search_path = checador, public;

ALTER TABLE empresas
  ADD COLUMN foto_sin_geocerca boolean NOT NULL DEFAULT true,          -- selfie obligatoria en desde casa / móvil
  ADD COLUMN ventana_diferida_h integer NOT NULL DEFAULT 48 CHECK (ventana_diferida_h BETWEEN 1 AND 168);
GRANT UPDATE (foto_sin_geocerca, ventana_diferida_h) ON empresas TO checador_app;

ALTER TABLE trabajadores
  ADD COLUMN dias_remotos smallint[] NOT NULL DEFAULT '{}'               -- ISO: 1 = lunes … 7 = domingo; vacío = cualquier día
    CHECK (dias_remotos <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  ADD COLUMN casa_lat numeric(9,6),
  ADD COLUMN casa_lng numeric(9,6),
  ADD COLUMN casa_radio_m integer NOT NULL DEFAULT 150 CHECK (casa_radio_m BETWEEN 30 AND 1000),
  ADD COLUMN casa_direccion text,
  ADD COLUMN casa_estado text CHECK (casa_estado IN ('PROPUESTA', 'APROBADA')),
  ADD COLUMN casa_actualizada_en timestamptz,
  ADD COLUMN casa_aprobada_por uuid REFERENCES cuentas(id),
  ADD CONSTRAINT casa_completa CHECK ((casa_estado IS NULL) = (casa_lat IS NULL) AND (casa_lat IS NULL) = (casa_lng IS NULL));

-- Fotos de las checadas. Se guardan aparte para no cargar las consultas del tablero.
CREATE TABLE fotos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  mime        text NOT NULL CHECK (mime IN ('image/jpeg', 'image/webp')),
  datos       bytea NOT NULL CHECK (length(datos) BETWEEN 1000 AND 400000),
  creada_en   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id)
);
ALTER TABLE fotos ENABLE ROW LEVEL SECURITY;
CREATE POLICY por_empresa ON fotos USING (empresa_id = current_setting('app.empresa_id', true)::uuid);
GRANT SELECT, INSERT ON fotos TO checador_app;

ALTER TABLE checadas
  ADD COLUMN foto_id uuid UNIQUE,
  ADD CONSTRAINT checadas_foto_fk FOREIGN KEY (empresa_id, foto_id) REFERENCES fotos(empresa_id, id);

/**
 * Carga histórica (migrar datos de otro checador, datos de ejemplo): sólo el
 * dueño del esquema puede activarla; el rol de la aplicación nunca.
 */
CREATE FUNCTION importando() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_user <> 'checador_app' AND current_setting('checador.importacion', true) = 'on'
$$;

CREATE OR REPLACE FUNCTION trg_checada() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  t    trabajadores;
  ct   centros;
  e    empresas;
  prev tipo_checada;
  prev_en timestamptz;
  inc  text[] := '{}';
  imp  boolean := importando();
  tarde interval;
BEGIN
  SELECT * INTO t FROM trabajadores WHERE id = NEW.trabajador_id AND empresa_id = NEW.empresa_id FOR UPDATE;
  IF NOT FOUND OR NOT t.activo THEN RAISE EXCEPTION 'Trabajador inactivo o inexistente'; END IF;
  SELECT * INTO e FROM empresas WHERE id = NEW.empresa_id;

  -- ------------------------------------------------------------ la hora
  IF NEW.ocurrido_en > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'La hora de la checada está en el futuro; revise el reloj del dispositivo';
  END IF;
  IF imp THEN
    NEW.recibido_en := NEW.ocurrido_en;
  ELSE
    NEW.recibido_en := now();
    -- el kiosco siempre usa la hora del servidor; el celular nunca puede checar "en el futuro"
    -- (el servidor ya corrigió la hora con el desfase del reloj del teléfono, ver servicios.ts)
    IF NEW.medio = 'KIOSCO' OR NEW.ocurrido_en > now() THEN
      NEW.ocurrido_en := now();
    END IF;
  END IF;
  NEW.fecha := (NEW.ocurrido_en AT TIME ZONE e.zona_horaria)::date;

  IF periodo_cerrado(NEW.empresa_id, NEW.fecha) THEN
    RAISE EXCEPTION 'El periodo que incluye el % ya está cerrado', to_char(NEW.fecha, 'DD/MM/YYYY');
  END IF;

  IF NEW.medio <> 'SUPERVISOR' THEN
    IF NOT (NEW.modalidad = ANY (t.modalidades)) THEN
      RAISE EXCEPTION '% no tiene habilitado checar en modalidad %', t.nombre,
        CASE NEW.modalidad WHEN 'LUGAR_FIJO' THEN 'lugar fijo' WHEN 'DESDE_CASA' THEN 'desde casa'
                           WHEN 'MOVIL' THEN 'móvil' ELSE 'kiosco' END;
    END IF;

    -- guardada sin señal: se acepta con su hora, pero RH la ve marcada
    tarde := NEW.recibido_en - NEW.ocurrido_en;
    IF NOT imp AND tarde > make_interval(hours => e.ventana_diferida_h) THEN
      RAISE EXCEPTION 'La checada llegó % h después de hecha y el límite es % h; pida a RH que la capture',
        floor(extract(epoch FROM tarde) / 3600), e.ventana_diferida_h;
    END IF;
    IF tarde > interval '5 minutes' THEN inc := inc || 'ENVIO_DIFERIDO'::text; END IF;

    -- foto: quien checa sin geocerca debe mostrar que es él
    IF NOT imp AND e.foto_sin_geocerca AND NEW.medio = 'CELULAR' AND NEW.modalidad IN ('DESDE_CASA', 'MOVIL')
       AND NEW.foto_id IS NULL THEN
      RAISE EXCEPTION 'Para checar % se necesita una foto', CASE NEW.modalidad WHEN 'DESDE_CASA' THEN 'desde casa' ELSE 'en movimiento' END;
    END IF;

    -- ------------------------------------------------------------ el lugar
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
        IF NEW.distancia_m > ct.radio_m + LEAST(COALESCE(NEW.precision_m, 0), 100) THEN
          inc := inc || 'FUERA_DE_ZONA'::text;
        END IF;
      END IF;
    ELSIF NEW.modalidad = 'DESDE_CASA' THEN
      NEW.centro_id := NULL;
      IF t.casa_estado IS DISTINCT FROM 'APROBADA' THEN
        inc := inc || 'CASA_SIN_APROBAR'::text;
      END IF;
      IF NEW.lat IS NULL THEN
        inc := inc || 'SIN_UBICACION'::text;
      ELSIF t.casa_estado = 'APROBADA' THEN
        NEW.distancia_m := round(distancia_m(NEW.lat, NEW.lng, t.casa_lat, t.casa_lng));
        IF NEW.distancia_m > t.casa_radio_m + LEAST(COALESCE(NEW.precision_m, 0), 100) THEN
          inc := inc || 'FUERA_DE_CASA'::text;
        END IF;
      END IF;
      IF cardinality(t.dias_remotos) > 0 AND NOT (extract(isodow FROM NEW.fecha)::smallint = ANY (t.dias_remotos)) THEN
        inc := inc || 'DIA_NO_REMOTO'::text;
      END IF;
    ELSIF NEW.modalidad = 'MOVIL' AND NEW.lat IS NULL THEN
      inc := inc || 'SIN_UBICACION'::text;
    END IF;
  END IF;

  -- ------------------------------------------------------------ la secuencia
  SELECT c.tipo, c.ocurrido_en INTO prev, prev_en FROM checadas c
   WHERE c.trabajador_id = NEW.trabajador_id AND c.ocurrido_en <= NEW.ocurrido_en
     AND NOT EXISTS (SELECT 1 FROM checadas_anuladas a WHERE a.checada_id = c.id)
   ORDER BY c.ocurrido_en DESC LIMIT 1;
  IF NEW.medio <> 'SUPERVISOR' AND prev = NEW.tipo AND NEW.ocurrido_en - prev_en < interval '2 minutes' THEN
    RAISE EXCEPTION 'Ya se registró % a las %', lower(replace(NEW.tipo::text, '_', ' ')),
      to_char(prev_en AT TIME ZONE e.zona_horaria, 'HH24:MI');
  END IF;
  IF NEW.ocurrido_en - prev_en > interval '16 hours' THEN prev := NULL; END IF;
  IF NOT (NEW.tipo = ANY (siguientes(prev))) THEN inc := inc || 'SECUENCIA'::text; END IF;

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

-- el cierre de periodo cuenta también las nuevas incidencias (todas menos el retardo, que va aparte)
CREATE OR REPLACE FUNCTION cerrar_periodo(p_periodo uuid, p_cuenta uuid) RETURNS integer LANGUAGE plpgsql AS $$
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
             AND cardinality(array_remove(c.incidencias, 'RETARDO')) > 0),
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

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA checador TO checador_app;
