-- =============================================================================
-- ObraClara — Esquema relacional de referencia (PostgreSQL 16)
-- -----------------------------------------------------------------------------
-- Principio rector: TODO costo (material, mano de obra, destajo, equipo) y TODO
-- movimiento de almacén se ancla a una "línea de control" del presupuesto
-- (concepto × insumo). El estado financiero de cada línea se lleva en un libro
-- mayor append-only (mov_presupuestales) con cuatro etapas:
--
--     RESERVADO  -> requisición aprobada (intención de gasto)
--     COMPROMETIDO -> OC emitida / contrato de destajo vigente (obligación)
--     EJERCIDO   -> material recibido / estimación aprobada (costo real)
--     PAGADO     -> dinero salido de bancos (dimensión de flujo, no consume saldo)
--
--     disponible = vigente - (reservado + comprometido + ejercido)
--
-- Migración inicial. Se aplica con el runner de packages/db:
--     pnpm db:migrate   (el runner envuelve cada migración en una transacción)
-- =============================================================================


CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

CREATE SCHEMA IF NOT EXISTS oc;
SET search_path = oc, public;

-- -----------------------------------------------------------------------------
-- Dominios y tipos
-- -----------------------------------------------------------------------------
CREATE DOMAIN d_cantidad AS numeric(18,4);
CREATE DOMAIN d_dinero   AS numeric(18,2);
CREATE DOMAIN d_pct      AS numeric(7,4) CHECK (VALUE >= 0 AND VALUE <= 100);

CREATE TYPE rol_usuario AS ENUM
  ('ADMIN','DIRECTOR','GERENTE_OBRA','RESIDENTE','CABO','COMPRAS','ALMACEN','FINANZAS');

CREATE TYPE estado_presupuesto AS ENUM ('BORRADOR','AUTORIZADO');
CREATE TYPE tipo_insumo AS ENUM ('MATERIAL','MANO_OBRA','EQUIPO','SUBCONTRATO','HERRAMIENTA','BOLSA');
CREATE TYPE semaforo AS ENUM ('VERDE','AMARILLO','ROJO');
CREATE TYPE etapa_presupuestal AS ENUM ('RESERVADO','COMPROMETIDO','EJERCIDO','PAGADO');

CREATE TYPE estado_requisicion AS ENUM
  ('BORRADOR','ENVIADA','APROBADA','RECHAZADA','EN_COMPRA','CERRADA','CANCELADA');
CREATE TYPE estado_oc AS ENUM
  ('BORRADOR','POR_AUTORIZAR','EMITIDA','RECIBIDA_PARCIAL','RECIBIDA','CERRADA','CANCELADA');
CREATE TYPE tipo_mov_almacen AS ENUM
  ('ENTRADA_OC','SALIDA_CONSUMO','DEVOLUCION_OBRA','TRASPASO_SALIDA','TRASPASO_ENTRADA','AJUSTE');
CREATE TYPE estado_avance AS ENUM ('CAPTURADO','VALIDADO','RECHAZADO');
CREATE TYPE estado_contrato AS ENUM ('BORRADOR','VIGENTE','TERMINADO','CANCELADO');
CREATE TYPE estado_estimacion AS ENUM ('BORRADOR','REVISADA','APROBADA','PAGADA','CANCELADA');
CREATE TYPE estado_factura AS ENUM ('RECIBIDA','VALIDADA','PROGRAMADA','PAGADA','RECHAZADA');
CREATE TYPE tipo_cambio AS ENUM ('ADITIVA','DEDUCTIVA','EXTRAORDINARIO','TRASPASO');
CREATE TYPE estado_cambio AS ENUM ('BORRADOR','SOLICITADA','AUTORIZADA','RECHAZADA');

-- -----------------------------------------------------------------------------
-- Tenancy, usuarios y seguridad
-- -----------------------------------------------------------------------------
CREATE TABLE empresas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      text NOT NULL,
  rfc         text,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  creado_en   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  email       text NOT NULL,
  nombre      text NOT NULL,
  telefono    text,
  activo      boolean NOT NULL DEFAULT true,
  limite_autorizacion d_dinero,            -- tope para aprobar OCs/requisiciones
  UNIQUE (empresa_id, email)
);

CREATE TABLE obras (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresas(id),
  clave         text NOT NULL,
  nombre        text NOT NULL,
  cliente       text,
  monto_contrato d_dinero,                 -- venta al cliente (sin IVA)
  fecha_inicio  date,
  fecha_fin     date,
  lat           numeric(9,6),
  lng           numeric(9,6),
  radio_geocerca_m integer NOT NULL DEFAULT 300,
  presupuesto_estado estado_presupuesto NOT NULL DEFAULT 'BORRADOR',
  presupuesto_autorizado_en timestamptz,
  -- tolerancias de control (pueden sobrescribirse por obra)
  tol_amarillo_pct numeric(6,2) NOT NULL DEFAULT 0,    -- >100% y <=100+tol_rojo => AMARILLO
  tol_rojo_pct     numeric(6,2) NOT NULL DEFAULT 5,    -- >100+tol_rojo => ROJO
  tol_precio_pct   numeric(6,2) NOT NULL DEFAULT 8,    -- precio vs. presupuesto
  tol_anticipo_pts numeric(6,2) NOT NULL DEFAULT 30,   -- consumo material vs avance físico
  tol_recepcion_pct numeric(6,2) NOT NULL DEFAULT 3,   -- sobre-entrega aceptada
  activa        boolean NOT NULL DEFAULT true,
  UNIQUE (empresa_id, clave),
  UNIQUE (empresa_id, id)
);

-- Un usuario puede tener varios roles en una obra (p.ej. RESIDENTE + ALMACEN)
CREATE TABLE obra_miembros (
  obra_id     uuid NOT NULL REFERENCES obras(id),
  usuario_id  uuid NOT NULL REFERENCES usuarios(id),
  rol         rol_usuario NOT NULL,
  PRIMARY KEY (obra_id, usuario_id, rol)
);
-- Roles de alcance empresa (DIRECTOR, FINANZAS, COMPRAS central)
CREATE TABLE empresa_roles (
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  usuario_id  uuid NOT NULL REFERENCES usuarios(id),
  rol         rol_usuario NOT NULL,
  PRIMARY KEY (empresa_id, usuario_id, rol)
);

-- -----------------------------------------------------------------------------
-- Catálogos
-- -----------------------------------------------------------------------------
CREATE TABLE insumos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  clave       text NOT NULL,
  descripcion text NOT NULL,
  unidad      text NOT NULL,
  tipo        tipo_insumo NOT NULL,
  UNIQUE (empresa_id, clave)
);

CREATE TABLE proveedores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresas(id),
  rfc           text,
  razon_social  text NOT NULL,
  es_contratista boolean NOT NULL DEFAULT false,   -- destajista / subcontratista
  clabe         text,
  contacto      jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (empresa_id, rfc)
);

-- -----------------------------------------------------------------------------
-- Presupuesto: partidas (árbol) -> conceptos -> líneas de control (concepto×insumo)
-- -----------------------------------------------------------------------------
CREATE TABLE partidas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id     uuid NOT NULL REFERENCES obras(id),
  parent_id   uuid REFERENCES partidas(id),
  clave       text NOT NULL,
  descripcion text NOT NULL,
  orden       integer NOT NULL DEFAULT 0,
  UNIQUE (obra_id, clave),
  UNIQUE (obra_id, id)
);

CREATE TABLE conceptos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id         uuid NOT NULL REFERENCES obras(id),
  partida_id      uuid NOT NULL,
  clave           text NOT NULL,
  descripcion     text NOT NULL,
  unidad          text NOT NULL,
  -- línea base (congelada al autorizar presupuesto)
  cantidad_base   d_cantidad NOT NULL CHECK (cantidad_base >= 0),
  pu_costo_base   d_dinero   NOT NULL CHECK (pu_costo_base >= 0),
  pu_venta        d_dinero,
  -- vigente = base + órdenes de cambio autorizadas
  cantidad_vigente d_cantidad NOT NULL,
  pu_costo_vigente d_dinero   NOT NULL,
  importe_costo_vigente d_dinero GENERATED ALWAYS AS (round(cantidad_vigente * pu_costo_vigente, 2)) STORED,
  es_extraordinario boolean NOT NULL DEFAULT false,
  UNIQUE (obra_id, clave),
  UNIQUE (obra_id, id),
  FOREIGN KEY (obra_id, partida_id) REFERENCES partidas(obra_id, id)
);

-- Línea de control = explosión de insumos (APU) por concepto.
-- En "modo simplificado" (presupuesto sin explosión) se crea UNA línea por
-- concepto con un insumo tipo BOLSA y se controla por importe.
CREATE TABLE lineas_control (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id         uuid NOT NULL,
  concepto_id     uuid NOT NULL,
  insumo_id       uuid NOT NULL REFERENCES insumos(id),
  cantidad_base   d_cantidad NOT NULL CHECK (cantidad_base >= 0),   -- total para el concepto
  precio_base     d_dinero   NOT NULL CHECK (precio_base >= 0),
  cantidad_vigente d_cantidad NOT NULL,
  precio_vigente   d_dinero   NOT NULL,
  importe_vigente  d_dinero GENERATED ALWAYS AS (round(cantidad_vigente * precio_vigente, 2)) STORED,
  UNIQUE (concepto_id, insumo_id),
  UNIQUE (obra_id, concepto_id, id),
  FOREIGN KEY (obra_id, concepto_id) REFERENCES conceptos(obra_id, id)
);

-- Programa de obra (para Valor Planeado / curva S)
CREATE TABLE programa_obra (
  obra_id      uuid NOT NULL,
  concepto_id  uuid NOT NULL,
  semana       date NOT NULL,                 -- lunes de la semana
  pct_planeado_acum d_pct NOT NULL,           -- % acumulado esperado al cierre de la semana
  PRIMARY KEY (concepto_id, semana),
  FOREIGN KEY (obra_id, concepto_id) REFERENCES conceptos(obra_id, id)
);

-- Órdenes de cambio: ÚNICA vía para modificar el presupuesto autorizado
CREATE TABLE ordenes_cambio (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id       uuid NOT NULL REFERENCES obras(id),
  folio         text NOT NULL,
  tipo          tipo_cambio NOT NULL,
  motivo        text NOT NULL,
  estado        estado_cambio NOT NULL DEFAULT 'BORRADOR',
  solicitado_por uuid NOT NULL REFERENCES usuarios(id),
  autorizado_por uuid REFERENCES usuarios(id),
  autorizado_en  timestamptz,
  UNIQUE (obra_id, folio),
  UNIQUE (obra_id, id)
);
CREATE TABLE ordenes_cambio_lineas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_cambio_id uuid NOT NULL,
  obra_id         uuid NOT NULL,
  concepto_id     uuid NOT NULL,
  linea_control_id uuid NOT NULL,
  delta_cantidad  d_cantidad NOT NULL DEFAULT 0,  -- puede ser negativo
  nuevo_precio    d_dinero,                       -- NULL = sin cambio
  FOREIGN KEY (obra_id, orden_cambio_id) REFERENCES ordenes_cambio(obra_id, id),
  FOREIGN KEY (obra_id, concepto_id, linea_control_id) REFERENCES lineas_control(obra_id, concepto_id, id)
);

-- -----------------------------------------------------------------------------
-- Archivos / evidencias (fotos, PDFs, XML CFDI). El binario vive en S3/R2.
-- -----------------------------------------------------------------------------
CREATE TABLE archivos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresas(id),
  storage_key   text NOT NULL UNIQUE,      -- empresa/obra/aaaa/mm/uuid.jpg
  mime          text NOT NULL,
  bytes         bigint,
  sha256        text NOT NULL,             -- detecta fotos recicladas
  tomada_en     timestamptz,               -- EXIF / reloj del dispositivo
  lat           numeric(9,6),
  lng           numeric(9,6),
  subido_por    uuid REFERENCES usuarios(id),
  subido_en     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_archivos_hash ON archivos (empresa_id, sha256);

CREATE TABLE evidencias (
  archivo_id    uuid NOT NULL REFERENCES archivos(id),
  entidad_tipo  text NOT NULL CHECK (entidad_tipo IN
                  ('AVANCE','RECEPCION','REQUISICION','MOV_ALMACEN','ESTIMACION','FACTURA','PAGO','COTIZACION')),
  entidad_id    uuid NOT NULL,
  PRIMARY KEY (archivo_id, entidad_tipo, entidad_id)
);
CREATE INDEX ix_evidencias_entidad ON evidencias (entidad_tipo, entidad_id);

-- -----------------------------------------------------------------------------
-- Requisiciones
-- -----------------------------------------------------------------------------
CREATE TABLE requisiciones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  obra_id        uuid NOT NULL,
  folio          text NOT NULL,
  solicitante_id uuid NOT NULL REFERENCES usuarios(id),
  fecha_requerida date,
  estado         estado_requisicion NOT NULL DEFAULT 'BORRADOR',
  client_uuid    uuid UNIQUE,                  -- idempotencia de sync offline
  creado_en      timestamptz NOT NULL DEFAULT now(),
  aprobada_por   uuid REFERENCES usuarios(id),
  aprobada_en    timestamptz,
  UNIQUE (obra_id, folio),
  UNIQUE (obra_id, id),
  FOREIGN KEY (empresa_id, obra_id) REFERENCES obras(empresa_id, id)
);

CREATE TABLE requisicion_lineas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisicion_id   uuid NOT NULL,
  obra_id          uuid NOT NULL,
  concepto_id      uuid NOT NULL,            -- NO NULL: no hay gasto sin concepto
  linea_control_id uuid NOT NULL,
  cantidad         d_cantidad NOT NULL CHECK (cantidad > 0),
  precio_estimado  d_dinero NOT NULL CHECK (precio_estimado >= 0),
  semaforo         semaforo,
  validacion       jsonb,                    -- snapshot del cálculo al validar
  justificacion    text,                     -- obligatoria si AMARILLO
  autoriza_excepcion_por uuid REFERENCES usuarios(id),
  orden_cambio_id  uuid REFERENCES ordenes_cambio(id),   -- obligatoria si ROJO
  UNIQUE (id, linea_control_id),
  FOREIGN KEY (obra_id, requisicion_id) REFERENCES requisiciones(obra_id, id),
  FOREIGN KEY (obra_id, concepto_id, linea_control_id) REFERENCES lineas_control(obra_id, concepto_id, id)
);

-- -----------------------------------------------------------------------------
-- Cotizaciones y Órdenes de compra
-- -----------------------------------------------------------------------------
CREATE TABLE cotizaciones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id        uuid NOT NULL,
  requisicion_id uuid NOT NULL,
  proveedor_id   uuid NOT NULL REFERENCES proveedores(id),
  fecha          date NOT NULL DEFAULT current_date,
  vigencia       date,
  dias_entrega   integer,
  seleccionada   boolean NOT NULL DEFAULT false,
  FOREIGN KEY (obra_id, requisicion_id) REFERENCES requisiciones(obra_id, id)
);
CREATE TABLE cotizacion_lineas (
  cotizacion_id        uuid NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
  requisicion_linea_id uuid NOT NULL REFERENCES requisicion_lineas(id),
  precio_unitario      d_dinero NOT NULL,
  PRIMARY KEY (cotizacion_id, requisicion_linea_id)
);

CREATE TABLE ordenes_compra (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL,
  obra_id       uuid NOT NULL,
  folio         text NOT NULL,
  proveedor_id  uuid NOT NULL REFERENCES proveedores(id),
  cotizacion_id uuid REFERENCES cotizaciones(id),
  estado        estado_oc NOT NULL DEFAULT 'BORRADOR',
  tasa_iva      numeric(5,4) NOT NULL DEFAULT 0.16,
  condiciones_pago text,
  fecha_entrega date,
  emitida_por   uuid REFERENCES usuarios(id),
  emitida_en    timestamptz,
  UNIQUE (obra_id, folio),
  UNIQUE (obra_id, id),
  FOREIGN KEY (empresa_id, obra_id) REFERENCES obras(empresa_id, id)
);

CREATE TABLE oc_lineas (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_compra_id      uuid NOT NULL,
  obra_id              uuid NOT NULL,
  requisicion_linea_id uuid NOT NULL,        -- NO hay OC sin requisición
  concepto_id          uuid NOT NULL,
  linea_control_id     uuid NOT NULL,
  cantidad             d_cantidad NOT NULL CHECK (cantidad > 0),
  precio_unitario      d_dinero NOT NULL CHECK (precio_unitario >= 0),
  importe              d_dinero GENERATED ALWAYS AS (round(cantidad * precio_unitario, 2)) STORED,
  cantidad_recibida    d_cantidad NOT NULL DEFAULT 0,
  semaforo_precio      semaforo,
  FOREIGN KEY (obra_id, orden_compra_id) REFERENCES ordenes_compra(obra_id, id),
  -- la línea de OC hereda EXACTAMENTE la línea de control de la requisición
  FOREIGN KEY (requisicion_linea_id, linea_control_id) REFERENCES requisicion_lineas(id, linea_control_id),
  FOREIGN KEY (obra_id, concepto_id, linea_control_id) REFERENCES lineas_control(obra_id, concepto_id, id)
);

-- -----------------------------------------------------------------------------
-- Recepción y almacén
-- -----------------------------------------------------------------------------
CREATE TABLE almacenes (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id  uuid NOT NULL REFERENCES obras(id),
  nombre   text NOT NULL,
  UNIQUE (obra_id, id)
);

CREATE TABLE recepciones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id         uuid NOT NULL,
  orden_compra_id uuid NOT NULL,
  almacen_id      uuid NOT NULL,
  recibio_id      uuid NOT NULL REFERENCES usuarios(id),
  fecha           timestamptz NOT NULL DEFAULT now(),
  remision_folio  text,
  lat             numeric(9,6),
  lng             numeric(9,6),
  client_uuid     uuid UNIQUE,
  FOREIGN KEY (obra_id, orden_compra_id) REFERENCES ordenes_compra(obra_id, id),
  FOREIGN KEY (obra_id, almacen_id) REFERENCES almacenes(obra_id, id),
  UNIQUE (obra_id, id)
);

CREATE TABLE recepcion_lineas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recepcion_id       uuid NOT NULL REFERENCES recepciones(id),
  oc_linea_id        uuid NOT NULL REFERENCES oc_lineas(id),
  cantidad_aceptada  d_cantidad NOT NULL CHECK (cantidad_aceptada >= 0),
  cantidad_rechazada d_cantidad NOT NULL DEFAULT 0 CHECK (cantidad_rechazada >= 0),
  motivo_rechazo     text,
  CHECK (cantidad_rechazada = 0 OR motivo_rechazo IS NOT NULL)
);

-- Kardex. El costo YA está cargado al concepto desde la recepción; las salidas
-- documentan el consumo físico y, si van a OTRO concepto, generan reclasificación.
CREATE TABLE movimientos_almacen (
  id              bigserial PRIMARY KEY,
  obra_id         uuid NOT NULL,
  almacen_id      uuid NOT NULL,
  insumo_id       uuid NOT NULL REFERENCES insumos(id),
  tipo            tipo_mov_almacen NOT NULL,
  cantidad        d_cantidad NOT NULL,        -- + entra, - sale
  costo_unitario  d_dinero NOT NULL,
  concepto_id     uuid,                       -- destino del consumo
  linea_control_id uuid,
  recepcion_linea_id uuid REFERENCES recepcion_lineas(id),
  contratista_id  uuid REFERENCES proveedores(id),  -- a quién se entregó
  cargo_a_contratista boolean NOT NULL DEFAULT false, -- se descuenta en su estimación
  motivo          text,
  autorizado_por  uuid REFERENCES usuarios(id),
  registrado_por  uuid NOT NULL REFERENCES usuarios(id),
  fecha           timestamptz NOT NULL DEFAULT now(),
  client_uuid     uuid UNIQUE,
  FOREIGN KEY (obra_id, almacen_id) REFERENCES almacenes(obra_id, id),
  FOREIGN KEY (obra_id, concepto_id, linea_control_id) REFERENCES lineas_control(obra_id, concepto_id, id),
  -- toda salida o devolución DEBE decir a qué concepto se fue
  CHECK (tipo NOT IN ('SALIDA_CONSUMO','DEVOLUCION_OBRA') OR (concepto_id IS NOT NULL AND linea_control_id IS NOT NULL)),
  -- los ajustes requieren motivo y autorizador
  CHECK (tipo <> 'AJUSTE' OR (motivo IS NOT NULL AND autorizado_por IS NOT NULL)),
  CHECK ((tipo IN ('ENTRADA_OC','TRASPASO_ENTRADA','DEVOLUCION_OBRA') AND cantidad > 0)
      OR (tipo IN ('SALIDA_CONSUMO','TRASPASO_SALIDA') AND cantidad < 0)
      OR tipo = 'AJUSTE')
);
CREATE INDEX ix_kardex ON movimientos_almacen (almacen_id, insumo_id, fecha);

-- -----------------------------------------------------------------------------
-- Destajos / subcontratos
-- -----------------------------------------------------------------------------
CREATE TABLE contratos_destajo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id         uuid NOT NULL REFERENCES obras(id),
  contratista_id  uuid NOT NULL REFERENCES proveedores(id),
  folio           text NOT NULL,
  pct_fondo_garantia numeric(5,2) NOT NULL DEFAULT 5 CHECK (pct_fondo_garantia BETWEEN 0 AND 30),
  monto_anticipo  d_dinero NOT NULL DEFAULT 0,
  pct_amortizacion numeric(5,2) NOT NULL DEFAULT 0,  -- normalmente = anticipo / monto contrato
  estado          estado_contrato NOT NULL DEFAULT 'BORRADOR',
  fecha_firma     date,
  UNIQUE (obra_id, folio),
  UNIQUE (obra_id, id)
);

CREATE TABLE contrato_destajo_lineas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id        uuid NOT NULL,
  obra_id            uuid NOT NULL,
  concepto_id        uuid NOT NULL,
  linea_control_id   uuid NOT NULL,          -- insumo tipo MANO_OBRA/SUBCONTRATO
  cantidad_contratada d_cantidad NOT NULL CHECK (cantidad_contratada > 0),
  pu_destajo         d_dinero NOT NULL CHECK (pu_destajo >= 0),
  UNIQUE (contrato_id, concepto_id),
  UNIQUE (obra_id, id),
  FOREIGN KEY (obra_id, contrato_id) REFERENCES contratos_destajo(obra_id, id),
  FOREIGN KEY (obra_id, concepto_id, linea_control_id) REFERENCES lineas_control(obra_id, concepto_id, id)
);

-- Avance físico reportado en campo (incremental, con foto obligatoria al validar)
CREATE TABLE avances (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id            uuid NOT NULL,
  concepto_id        uuid NOT NULL,
  contrato_linea_id  uuid,                    -- NULL = avance de obra propia
  cantidad           d_cantidad NOT NULL CHECK (cantidad > 0),
  fecha              date NOT NULL,
  ubicacion_texto    text,                    -- "Eje 3-4, nivel 2"
  lat                numeric(9,6),
  lng                numeric(9,6),
  estado             estado_avance NOT NULL DEFAULT 'CAPTURADO',
  capturado_por      uuid NOT NULL REFERENCES usuarios(id),
  validado_por       uuid REFERENCES usuarios(id),
  validado_en        timestamptz,
  motivo_rechazo     text,
  client_uuid        uuid UNIQUE,
  FOREIGN KEY (obra_id, concepto_id) REFERENCES conceptos(obra_id, id),
  FOREIGN KEY (obra_id, contrato_linea_id) REFERENCES contrato_destajo_lineas(obra_id, id),
  CHECK (estado <> 'VALIDADO' OR (validado_por IS NOT NULL AND validado_por <> capturado_por))
);
CREATE INDEX ix_avances_concepto ON avances (concepto_id) WHERE estado = 'VALIDADO';

CREATE TABLE estimaciones_destajo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id         uuid NOT NULL,
  contrato_id     uuid NOT NULL,
  numero          integer NOT NULL,
  periodo_inicio  date NOT NULL,
  periodo_fin     date NOT NULL,
  estado          estado_estimacion NOT NULL DEFAULT 'BORRADOR',
  subtotal        d_dinero NOT NULL DEFAULT 0,
  amortizacion_anticipo d_dinero NOT NULL DEFAULT 0,
  retencion_fg    d_dinero NOT NULL DEFAULT 0,
  deductivas      d_dinero NOT NULL DEFAULT 0,
  neto_a_pagar    d_dinero NOT NULL DEFAULT 0,
  revisada_por    uuid REFERENCES usuarios(id),
  aprobada_por    uuid REFERENCES usuarios(id),
  aprobada_en     timestamptz,
  UNIQUE (contrato_id, numero),
  UNIQUE (obra_id, id),
  FOREIGN KEY (obra_id, contrato_id) REFERENCES contratos_destajo(obra_id, id),
  CHECK (periodo_fin >= periodo_inicio)
);

CREATE TABLE estimacion_destajo_lineas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimacion_id      uuid NOT NULL REFERENCES estimaciones_destajo(id) ON DELETE CASCADE,
  contrato_linea_id  uuid NOT NULL REFERENCES contrato_destajo_lineas(id),
  cantidad_anterior  d_cantidad NOT NULL,
  cantidad_periodo   d_cantidad NOT NULL CHECK (cantidad_periodo > 0),
  cantidad_acumulada d_cantidad NOT NULL,
  pu_destajo         d_dinero NOT NULL,
  importe            d_dinero GENERATED ALWAYS AS (round(cantidad_periodo * pu_destajo, 2)) STORED,
  UNIQUE (estimacion_id, contrato_linea_id)
);

CREATE TABLE estimacion_deductivas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimacion_id   uuid NOT NULL REFERENCES estimaciones_destajo(id) ON DELETE CASCADE,
  descripcion     text NOT NULL,
  importe         d_dinero NOT NULL CHECK (importe > 0),
  movimiento_almacen_id bigint UNIQUE REFERENCES movimientos_almacen(id)  -- material cargado
);

CREATE TABLE fondo_garantia_liberaciones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id  uuid NOT NULL REFERENCES contratos_destajo(id),
  importe      d_dinero NOT NULL CHECK (importe > 0),
  fecha        date NOT NULL,
  autorizado_por uuid NOT NULL REFERENCES usuarios(id),
  acta_archivo_id uuid REFERENCES archivos(id)
);

-- -----------------------------------------------------------------------------
-- Facturas y pagos
-- -----------------------------------------------------------------------------
CREATE TABLE facturas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresas(id),
  proveedor_id  uuid NOT NULL REFERENCES proveedores(id),
  uuid_cfdi     uuid,                          -- folio fiscal SAT (México)
  serie_folio   text,
  fecha         date NOT NULL,
  subtotal      d_dinero NOT NULL,
  iva           d_dinero NOT NULL DEFAULT 0,
  retenciones   d_dinero NOT NULL DEFAULT 0,
  total         d_dinero NOT NULL,
  estado        estado_factura NOT NULL DEFAULT 'RECIBIDA',
  xml_archivo_id uuid REFERENCES archivos(id),
  pdf_archivo_id uuid REFERENCES archivos(id),
  vence_en      date,
  UNIQUE (empresa_id, uuid_cfdi)                -- impide capturar dos veces la misma factura
);

-- Conciliación de 3 vías: factura <-> línea de OC (que ya tiene recepción)
CREATE TABLE factura_lineas_oc (
  factura_id   uuid NOT NULL REFERENCES facturas(id),
  oc_linea_id  uuid NOT NULL REFERENCES oc_lineas(id),
  cantidad     d_cantidad NOT NULL CHECK (cantidad > 0),
  importe      d_dinero NOT NULL CHECK (importe >= 0),   -- subtotal facturado de la línea
  PRIMARY KEY (factura_id, oc_linea_id)
);

CREATE TABLE pagos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresas(id),
  proveedor_id  uuid NOT NULL REFERENCES proveedores(id),
  fecha         date NOT NULL,
  monto         d_dinero NOT NULL CHECK (monto > 0),
  metodo        text NOT NULL,                 -- SPEI, cheque, efectivo
  referencia    text,
  comprobante_archivo_id uuid REFERENCES archivos(id),
  registrado_por uuid NOT NULL REFERENCES usuarios(id)
);

CREATE TABLE pago_aplicaciones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pago_id       uuid NOT NULL REFERENCES pagos(id),
  factura_id    uuid REFERENCES facturas(id),
  estimacion_id uuid REFERENCES estimaciones_destajo(id),
  importe       d_dinero NOT NULL CHECK (importe > 0),
  CHECK ((factura_id IS NULL) <> (estimacion_id IS NULL))   -- exactamente uno
);

-- -----------------------------------------------------------------------------
-- LIBRO MAYOR PRESUPUESTAL (append-only) — corazón de la reconciliación
-- -----------------------------------------------------------------------------
CREATE TABLE mov_presupuestales (
  id               bigserial PRIMARY KEY,
  obra_id          uuid NOT NULL,
  concepto_id      uuid NOT NULL,
  linea_control_id uuid NOT NULL,
  etapa            etapa_presupuestal NOT NULL,
  cantidad         d_cantidad NOT NULL DEFAULT 0,   -- con signo
  importe          d_dinero NOT NULL,               -- con signo (sin IVA)
  doc_tipo         text NOT NULL,                   -- REQ, OC, REC, CONTRATO, EST, PAGO, RECLASIF
  doc_id           uuid,
  doc_linea_id     uuid,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (obra_id, concepto_id, linea_control_id) REFERENCES lineas_control(obra_id, concepto_id, id)
);
CREATE INDEX ix_mov_linea ON mov_presupuestales (linea_control_id, etapa);
CREATE INDEX ix_mov_obra  ON mov_presupuestales (obra_id, etapa);

CREATE TABLE alertas (
  id          bigserial PRIMARY KEY,
  obra_id     uuid NOT NULL REFERENCES obras(id),
  tipo        text NOT NULL,
  severidad   semaforo NOT NULL,
  entidad_tipo text,
  entidad_id  uuid,
  mensaje     text NOT NULL,
  datos       jsonb NOT NULL DEFAULT '{}'::jsonb,
  estado      text NOT NULL DEFAULT 'ABIERTA' CHECK (estado IN ('ABIERTA','ATENDIDA','DESCARTADA')),
  creada_en   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auditoria (
  id          bigserial PRIMARY KEY,
  empresa_id  uuid,
  usuario_id  uuid,
  tabla       text NOT NULL,
  registro_id text NOT NULL,
  accion      text NOT NULL,
  antes       jsonb,
  despues     jsonb,
  en          timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- REGLAS DE INTEGRIDAD (triggers)
-- =============================================================================

-- 1) Libro mayor inmutable: correcciones sólo por contra-asiento
CREATE FUNCTION trg_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% es append-only; registre un contra-asiento', TG_TABLE_NAME;
END $$;
CREATE TRIGGER mov_presupuestales_inmutable BEFORE UPDATE OR DELETE ON mov_presupuestales
  FOR EACH ROW EXECUTE FUNCTION trg_inmutable();

-- 2) Presupuesto autorizado congelado: base intocable; vigente sólo vía orden de cambio
CREATE FUNCTION trg_congelar_presupuesto() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_estado estado_presupuesto;
BEGIN
  SELECT presupuesto_estado INTO v_estado FROM obras WHERE id = COALESCE(NEW.obra_id, OLD.obra_id);
  IF v_estado = 'AUTORIZADO' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Presupuesto autorizado: no se pueden borrar renglones';
    END IF;
    IF TG_OP = 'INSERT' AND current_setting('oc.via_orden_cambio', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Presupuesto autorizado: agregue conceptos/insumos mediante una orden de cambio (EXTRAORDINARIO)';
    END IF;
    IF TG_OP = 'UPDATE' THEN
      -- (jsonb porque conceptos y lineas_control tienen columnas base distintas)
      IF (to_jsonb(NEW) - 'cantidad_vigente' - 'pu_costo_vigente' - 'precio_vigente'
                        - 'importe_costo_vigente' - 'importe_vigente')
         IS DISTINCT FROM
         (to_jsonb(OLD) - 'cantidad_vigente' - 'pu_costo_vigente' - 'precio_vigente'
                        - 'importe_costo_vigente' - 'importe_vigente') THEN
        RAISE EXCEPTION 'La línea base del presupuesto es inmutable una vez autorizada';
      END IF;
      IF current_setting('oc.via_orden_cambio', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'Los valores vigentes sólo cambian aplicando una orden de cambio autorizada';
      END IF;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER conceptos_congelados BEFORE INSERT OR UPDATE OR DELETE ON conceptos
  FOR EACH ROW EXECUTE FUNCTION trg_congelar_presupuesto();
CREATE TRIGGER lineas_control_congeladas BEFORE INSERT OR UPDATE OR DELETE ON lineas_control
  FOR EACH ROW EXECUTE FUNCTION trg_congelar_presupuesto();

-- vigente = base al crear
CREATE FUNCTION trg_vigente_desde_base() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'conceptos' THEN
    NEW.cantidad_vigente := COALESCE(NEW.cantidad_vigente, NEW.cantidad_base);
    NEW.pu_costo_vigente := COALESCE(NEW.pu_costo_vigente, NEW.pu_costo_base);
  ELSE
    NEW.cantidad_vigente := COALESCE(NEW.cantidad_vigente, NEW.cantidad_base);
    NEW.precio_vigente   := COALESCE(NEW.precio_vigente, NEW.precio_base);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER conceptos_vigente BEFORE INSERT ON conceptos
  FOR EACH ROW EXECUTE FUNCTION trg_vigente_desde_base();
CREATE TRIGGER lineas_control_vigente BEFORE INSERT ON lineas_control
  FOR EACH ROW EXECUTE FUNCTION trg_vigente_desde_base();

-- 3) Aplicar orden de cambio autorizada (traspasos deben sumar cero en importe)
CREATE FUNCTION fn_aplicar_orden_cambio(p_orden uuid, p_usuario uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r record; v_tipo tipo_cambio; v_neto numeric := 0;
BEGIN
  SELECT tipo INTO v_tipo FROM ordenes_cambio WHERE id = p_orden AND estado = 'SOLICITADA' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden de cambio % no está SOLICITADA', p_orden; END IF;

  IF v_tipo = 'TRASPASO' THEN
    SELECT sum(l.delta_cantidad * COALESCE(l.nuevo_precio, lc.precio_vigente)) INTO v_neto
      FROM ordenes_cambio_lineas l JOIN lineas_control lc ON lc.id = l.linea_control_id
     WHERE l.orden_cambio_id = p_orden;
    IF abs(v_neto) > 0.01 THEN
      RAISE EXCEPTION 'Un traspaso debe ser neutro en importe (neto = %)', v_neto;
    END IF;
  END IF;

  PERFORM set_config('oc.via_orden_cambio', 'on', true);
  FOR r IN SELECT * FROM ordenes_cambio_lineas WHERE orden_cambio_id = p_orden LOOP
    UPDATE lineas_control
       SET cantidad_vigente = cantidad_vigente + r.delta_cantidad,
           precio_vigente   = COALESCE(r.nuevo_precio, precio_vigente)
     WHERE id = r.linea_control_id;
  END LOOP;
  -- el importe vigente del concepto se recalcula desde sus líneas de control
  UPDATE conceptos c
     SET pu_costo_vigente = CASE WHEN c.cantidad_vigente > 0
                                 THEN round(s.importe / c.cantidad_vigente, 2) ELSE 0 END
    FROM (SELECT lc.concepto_id, sum(lc.importe_vigente) importe
            FROM lineas_control lc
           WHERE lc.concepto_id IN (SELECT concepto_id FROM ordenes_cambio_lineas WHERE orden_cambio_id = p_orden)
           GROUP BY lc.concepto_id) s
   WHERE c.id = s.concepto_id;
  PERFORM set_config('oc.via_orden_cambio', 'off', true);

  UPDATE ordenes_cambio SET estado = 'AUTORIZADA', autorizado_por = p_usuario, autorizado_en = now()
   WHERE id = p_orden;
END $$;

-- 4) Saldos por línea de control (lectura en vivo del libro mayor)
CREATE VIEW v_saldo_linea_control AS
SELECT lc.id AS linea_control_id, lc.obra_id, lc.concepto_id, lc.insumo_id,
       lc.cantidad_vigente, lc.precio_vigente, lc.importe_vigente,
       COALESCE(sum(m.cantidad) FILTER (WHERE m.etapa = 'RESERVADO'),0)    AS cant_reservada,
       COALESCE(sum(m.cantidad) FILTER (WHERE m.etapa = 'COMPROMETIDO'),0) AS cant_comprometida,
       COALESCE(sum(m.cantidad) FILTER (WHERE m.etapa = 'EJERCIDO'),0)     AS cant_ejercida,
       COALESCE(sum(m.importe)  FILTER (WHERE m.etapa = 'RESERVADO'),0)    AS imp_reservado,
       COALESCE(sum(m.importe)  FILTER (WHERE m.etapa = 'COMPROMETIDO'),0) AS imp_comprometido,
       COALESCE(sum(m.importe)  FILTER (WHERE m.etapa = 'EJERCIDO'),0)     AS imp_ejercido,
       COALESCE(sum(m.importe)  FILTER (WHERE m.etapa = 'PAGADO'),0)       AS imp_pagado,
       lc.cantidad_vigente - COALESCE(sum(m.cantidad) FILTER (WHERE m.etapa <> 'PAGADO'),0) AS cant_disponible,
       lc.importe_vigente  - COALESCE(sum(m.importe)  FILTER (WHERE m.etapa <> 'PAGADO'),0) AS imp_disponible
  FROM lineas_control lc
  LEFT JOIN mov_presupuestales m ON m.linea_control_id = lc.id
 GROUP BY lc.id;

-- Avance físico validado por concepto
CREATE VIEW v_avance_concepto AS
SELECT c.id AS concepto_id, c.obra_id, c.cantidad_vigente,
       COALESCE(sum(a.cantidad) FILTER (WHERE a.estado = 'VALIDADO'),0) AS cant_ejecutada,
       CASE WHEN c.cantidad_vigente > 0
            THEN least(100, round(100 * COALESCE(sum(a.cantidad) FILTER (WHERE a.estado = 'VALIDADO'),0)
                                  / c.cantidad_vigente, 2))
            ELSE 0 END AS pct_fisico
  FROM conceptos c LEFT JOIN avances a ON a.concepto_id = c.id
 GROUP BY c.id;

-- =============================================================================
-- VALIDACIÓN PREVIA DE REQUISICIONES (semáforo)
-- =============================================================================
CREATE FUNCTION fn_validar_linea_requisicion(
  p_linea_control uuid, p_cantidad numeric, p_precio numeric)
RETURNS TABLE (resultado semaforo, detalle jsonb)
LANGUAGE plpgsql AS $$
DECLARE
  lc record; s record; o record; v_fisico numeric;
  v_pct_cant numeric; v_pct_imp numeric; v_pct_precio numeric; v_importe numeric;
  v_motivos text[] := '{}'; v_res semaforo := 'VERDE';
BEGIN
  -- Bloqueo pesimista: dos requisiciones simultáneas sobre la misma línea se serializan
  SELECT * INTO lc FROM lineas_control WHERE id = p_linea_control FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Línea de control inexistente'; END IF;
  SELECT * INTO o FROM obras WHERE id = lc.obra_id;
  SELECT * INTO s FROM v_saldo_linea_control WHERE linea_control_id = p_linea_control;

  v_importe  := round(p_cantidad * p_precio, 2);
  v_pct_cant := CASE WHEN lc.cantidad_vigente > 0
                     THEN 100 * (lc.cantidad_vigente - s.cant_disponible + p_cantidad) / lc.cantidad_vigente
                     ELSE 999 END;
  v_pct_imp  := CASE WHEN lc.importe_vigente > 0
                     THEN 100 * (lc.importe_vigente - s.imp_disponible + v_importe) / lc.importe_vigente
                     ELSE 999 END;
  v_pct_precio := CASE WHEN lc.precio_vigente > 0
                       THEN 100 * (p_precio - lc.precio_vigente) / lc.precio_vigente ELSE 0 END;
  SELECT pct_fisico INTO v_fisico FROM v_avance_concepto WHERE concepto_id = lc.concepto_id;

  -- Regla 1: volumen / importe
  IF greatest(v_pct_cant, v_pct_imp) > 100 + o.tol_rojo_pct THEN
    v_res := 'ROJO';
    v_motivos := v_motivos || format('Excede presupuesto: %s%% de volumen, %s%% de importe (tolerancia %s%%)',
                                     round(v_pct_cant,1), round(v_pct_imp,1), o.tol_rojo_pct);
  ELSIF greatest(v_pct_cant, v_pct_imp) > 100 + o.tol_amarillo_pct THEN
    v_res := 'AMARILLO';
    v_motivos := v_motivos || format('Sobregiro dentro de tolerancia: %s%%', round(greatest(v_pct_cant, v_pct_imp),1));
  END IF;

  -- Regla 2: precio por encima del presupuestado
  IF v_pct_precio > o.tol_precio_pct THEN
    IF v_res = 'VERDE' THEN v_res := 'AMARILLO'; END IF;
    v_motivos := v_motivos || format('Precio %s%% arriba del presupuesto', round(v_pct_precio,1));
  END IF;

  -- Regla 3: consumo anticipado (se pide mucho más material del que el avance justifica)
  IF v_pct_cant - v_fisico > o.tol_anticipo_pts AND v_pct_cant > 50 THEN
    IF v_res = 'VERDE' THEN v_res := 'AMARILLO'; END IF;
    v_motivos := v_motivos || format('Consumo anticipado: material al %s%% con avance físico de %s%%',
                                     round(v_pct_cant,1), v_fisico);
  END IF;

  RETURN QUERY SELECT v_res, jsonb_build_object(
      'cantidad_vigente', lc.cantidad_vigente, 'cantidad_disponible', s.cant_disponible,
      'importe_vigente', lc.importe_vigente,   'importe_disponible',  s.imp_disponible,
      'pct_consumo_cantidad', round(v_pct_cant,2), 'pct_consumo_importe', round(v_pct_imp,2),
      'pct_desvio_precio', round(v_pct_precio,2), 'pct_avance_fisico', v_fisico,
      'motivos', to_jsonb(v_motivos), 'validado_en', now());
END $$;

-- Al ENVIAR: calcula semáforo de cada línea (informativo para quien aprueba)
-- Al APROBAR: re-valida bajo bloqueo, exige justificación/orden de cambio y reserva
CREATE FUNCTION trg_requisicion_estado() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l record; v record;
BEGIN
  IF NEW.estado = OLD.estado THEN RETURN NEW; END IF;

  IF NEW.estado IN ('ENVIADA','APROBADA') THEN
    FOR l IN SELECT * FROM requisicion_lineas WHERE requisicion_id = NEW.id ORDER BY linea_control_id LOOP
      SELECT * INTO v FROM fn_validar_linea_requisicion(l.linea_control_id, l.cantidad, l.precio_estimado);
      UPDATE requisicion_lineas SET semaforo = v.resultado, validacion = v.detalle WHERE id = l.id;

      IF NEW.estado = 'APROBADA' THEN
        IF v.resultado = 'AMARILLO' AND (l.justificacion IS NULL OR l.autoriza_excepcion_por IS NULL) THEN
          RAISE EXCEPTION 'Línea % en AMARILLO: requiere justificación y autorización del gerente', l.id;
        END IF;
        IF v.resultado = 'ROJO' THEN
          RAISE EXCEPTION 'Línea % en ROJO: bloqueada. Tramite una orden de cambio (aditiva o traspaso) y vuelva a enviar. %',
                          l.id, v.detalle->'motivos';
        END IF;
        INSERT INTO mov_presupuestales(obra_id, concepto_id, linea_control_id, etapa, cantidad, importe,
                                       doc_tipo, doc_id, doc_linea_id)
        VALUES (l.obra_id, l.concepto_id, l.linea_control_id, 'RESERVADO', l.cantidad,
                round(l.cantidad * l.precio_estimado, 2), 'REQ', NEW.id, l.id);
      END IF;
    END LOOP;
    IF NEW.estado = 'APROBADA' THEN NEW.aprobada_en := now(); END IF;
  END IF;

  -- Cancelar / cerrar libera lo reservado que no se convirtió en OC
  IF NEW.estado IN ('CANCELADA','CERRADA') THEN
    INSERT INTO mov_presupuestales(obra_id, concepto_id, linea_control_id, etapa, cantidad, importe,
                                   doc_tipo, doc_id, doc_linea_id)
    SELECT m.obra_id, m.concepto_id, m.linea_control_id, 'RESERVADO', -sum(m.cantidad), -sum(m.importe),
           'REQ', NEW.id, m.doc_linea_id
      FROM mov_presupuestales m
     WHERE m.etapa = 'RESERVADO' AND m.doc_linea_id IN (SELECT id FROM requisicion_lineas WHERE requisicion_id = NEW.id)
     GROUP BY m.obra_id, m.concepto_id, m.linea_control_id, m.doc_linea_id
    HAVING sum(m.cantidad) <> 0 OR sum(m.importe) <> 0;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER requisiciones_estado BEFORE UPDATE OF estado ON requisiciones
  FOR EACH ROW EXECUTE FUNCTION trg_requisicion_estado();

-- =============================================================================
-- ORDEN DE COMPRA: reserva -> compromiso
-- =============================================================================
CREATE FUNCTION trg_oc_estado() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l record; v_res_cant numeric; v_res_imp numeric; v_lib_cant numeric; v_lib_imp numeric;
        v_pct numeric; v_tol numeric;
BEGIN
  IF NEW.estado = OLD.estado THEN RETURN NEW; END IF;

  IF NEW.estado = 'EMITIDA' AND OLD.estado IN ('BORRADOR','POR_AUTORIZAR') THEN
    SELECT tol_precio_pct INTO v_tol FROM obras WHERE id = NEW.obra_id;
    FOR l IN SELECT ol.*, rl.cantidad AS req_cant, r.estado AS req_estado, lc.precio_vigente
               FROM oc_lineas ol
               JOIN requisicion_lineas rl ON rl.id = ol.requisicion_linea_id
               JOIN requisiciones r ON r.id = rl.requisicion_id
               JOIN lineas_control lc ON lc.id = ol.linea_control_id
              WHERE ol.orden_compra_id = NEW.id
              ORDER BY ol.linea_control_id
              FOR UPDATE OF lc LOOP
      IF l.req_estado NOT IN ('APROBADA','EN_COMPRA') THEN
        RAISE EXCEPTION 'La requisición de la línea % no está aprobada', l.id;
      END IF;
      -- saldo aún reservado de esa línea de requisición
      SELECT COALESCE(sum(cantidad),0), COALESCE(sum(importe),0) INTO v_res_cant, v_res_imp
        FROM mov_presupuestales WHERE doc_linea_id = l.requisicion_linea_id AND etapa = 'RESERVADO';
      IF l.cantidad > v_res_cant + 0.0001 THEN
        RAISE EXCEPTION 'OC línea %: cantidad % excede lo reservado en la requisición (%)', l.id, l.cantidad, v_res_cant;
      END IF;
      -- semáforo de precio (variación de precio vs. presupuesto)
      v_pct := CASE WHEN l.precio_vigente > 0 THEN 100*(l.precio_unitario - l.precio_vigente)/l.precio_vigente ELSE 0 END;
      UPDATE oc_lineas SET semaforo_precio = CASE WHEN v_pct > v_tol THEN 'ROJO'::semaforo
                                                  WHEN v_pct > 0 THEN 'AMARILLO'::semaforo
                                                  ELSE 'VERDE'::semaforo END
       WHERE id = l.id;
      -- libera la reserva proporcional y crea el compromiso al precio real
      v_lib_cant := l.cantidad;
      v_lib_imp  := CASE WHEN v_res_cant > 0 THEN round(v_res_imp * l.cantidad / v_res_cant, 2) ELSE 0 END;
      INSERT INTO mov_presupuestales(obra_id, concepto_id, linea_control_id, etapa, cantidad, importe, doc_tipo, doc_id, doc_linea_id)
      VALUES (l.obra_id, l.concepto_id, l.linea_control_id, 'RESERVADO', -v_lib_cant, -v_lib_imp, 'OC', NEW.id, l.requisicion_linea_id),
             (l.obra_id, l.concepto_id, l.linea_control_id, 'COMPROMETIDO', l.cantidad, l.importe, 'OC', NEW.id, l.id);
    END LOOP;
    -- el excedente de precio sobre la reserva queda visible: si deja la línea
    -- con disponible negativo, se levanta alerta (no se bloquea la OC ya cotizada)
    INSERT INTO alertas(obra_id, tipo, severidad, entidad_tipo, entidad_id, mensaje, datos)
    SELECT NEW.obra_id, 'SOBRECOSTO_PRECIO', 'ROJO', 'OC', NEW.id,
           format('OC %s deja la línea de control con saldo negativo', NEW.folio),
           jsonb_build_object('linea_control_id', s.linea_control_id, 'imp_disponible', s.imp_disponible)
      FROM v_saldo_linea_control s
     WHERE s.linea_control_id IN (SELECT linea_control_id FROM oc_lineas WHERE orden_compra_id = NEW.id)
       AND s.imp_disponible < 0;
    NEW.emitida_en := now();
  END IF;

  IF NEW.estado = 'CANCELADA' AND OLD.estado NOT IN ('BORRADOR','POR_AUTORIZAR') THEN
    -- libera lo comprometido no recibido (la reserva NO regresa: la requisición se re-envía)
    INSERT INTO mov_presupuestales(obra_id, concepto_id, linea_control_id, etapa, cantidad, importe, doc_tipo, doc_id, doc_linea_id)
    SELECT ol.obra_id, ol.concepto_id, ol.linea_control_id, 'COMPROMETIDO',
           -(ol.cantidad - ol.cantidad_recibida), -round((ol.cantidad - ol.cantidad_recibida) * ol.precio_unitario, 2),
           'OC', NEW.id, ol.id
      FROM oc_lineas ol WHERE ol.orden_compra_id = NEW.id AND ol.cantidad > ol.cantidad_recibida;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ordenes_compra_estado BEFORE UPDATE OF estado ON ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION trg_oc_estado();

-- =============================================================================
-- RECEPCIÓN: compromiso -> ejercido + entrada a almacén
-- =============================================================================
CREATE FUNCTION trg_recepcion_linea() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ol record; r record; v_tol numeric; v_insumo uuid; v_cant numeric; v_imp numeric;
BEGIN
  SELECT * INTO ol FROM oc_lineas WHERE id = NEW.oc_linea_id FOR UPDATE;
  SELECT rc.*, o.tol_recepcion_pct, oc.estado AS oc_estado
    INTO r FROM recepciones rc JOIN obras o ON o.id = rc.obra_id
    JOIN ordenes_compra oc ON oc.id = rc.orden_compra_id
   WHERE rc.id = NEW.recepcion_id;
  IF ol.orden_compra_id <> r.orden_compra_id THEN
    RAISE EXCEPTION 'La línea de OC no pertenece a la OC de la recepción';
  END IF;
  IF r.oc_estado NOT IN ('EMITIDA','RECIBIDA_PARCIAL') THEN
    RAISE EXCEPTION 'Sólo se recibe contra OC emitida (estado actual %)', r.oc_estado;
  END IF;
  IF ol.cantidad_recibida + NEW.cantidad_aceptada > ol.cantidad * (1 + r.tol_recepcion_pct/100) THEN
    RAISE EXCEPTION 'Recepción excede lo ordenado (% + % > % con tolerancia de % %%)',
      ol.cantidad_recibida, NEW.cantidad_aceptada, ol.cantidad, r.tol_recepcion_pct;
  END IF;
  IF NEW.cantidad_aceptada = 0 THEN RETURN NEW; END IF;

  UPDATE oc_lineas SET cantidad_recibida = cantidad_recibida + NEW.cantidad_aceptada WHERE id = ol.id;

  -- el compromiso sólo se reduce hasta lo comprometido; la sobre-entrega tolerada va directo a ejercido
  v_cant := least(NEW.cantidad_aceptada, greatest(ol.cantidad - ol.cantidad_recibida, 0));
  v_imp  := round(v_cant * ol.precio_unitario, 2);
  INSERT INTO mov_presupuestales(obra_id, concepto_id, linea_control_id, etapa, cantidad, importe, doc_tipo, doc_id, doc_linea_id)
  VALUES (ol.obra_id, ol.concepto_id, ol.linea_control_id, 'COMPROMETIDO', -v_cant, -v_imp, 'REC', NEW.recepcion_id, NEW.id),
         (ol.obra_id, ol.concepto_id, ol.linea_control_id, 'EJERCIDO', NEW.cantidad_aceptada,
          round(NEW.cantidad_aceptada * ol.precio_unitario, 2), 'REC', NEW.recepcion_id, NEW.id);

  SELECT insumo_id INTO v_insumo FROM lineas_control WHERE id = ol.linea_control_id;
  INSERT INTO movimientos_almacen(obra_id, almacen_id, insumo_id, tipo, cantidad, costo_unitario,
                                  concepto_id, linea_control_id, recepcion_linea_id, registrado_por, fecha)
  VALUES (ol.obra_id, r.almacen_id, v_insumo, 'ENTRADA_OC', NEW.cantidad_aceptada, ol.precio_unitario,
          ol.concepto_id, ol.linea_control_id, NEW.id, r.recibio_id, r.fecha);

  UPDATE ordenes_compra oc
     SET estado = CASE WHEN NOT EXISTS (SELECT 1 FROM oc_lineas x WHERE x.orden_compra_id = oc.id
                                         AND x.cantidad_recibida < x.cantidad)
                       THEN 'RECIBIDA'::estado_oc ELSE 'RECIBIDA_PARCIAL'::estado_oc END
   WHERE oc.id = ol.orden_compra_id;
  RETURN NEW;
END $$;
CREATE TRIGGER recepcion_lineas_aplicar AFTER INSERT ON recepcion_lineas
  FOR EACH ROW EXECUTE FUNCTION trg_recepcion_linea();

-- Existencias por almacén
CREATE VIEW v_existencias AS
SELECT obra_id, almacen_id, insumo_id, sum(cantidad) AS existencia,
       max(fecha) FILTER (WHERE cantidad < 0) AS ultima_salida
  FROM movimientos_almacen GROUP BY obra_id, almacen_id, insumo_id;

-- Salidas: no se puede sacar lo que no hay; salida a un concepto distinto
-- al que pagó el material => reclasificación de costo en el libro mayor.
CREATE FUNCTION trg_mov_almacen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_exist numeric; v_origen record; v_insumo_destino uuid;
BEGIN
  IF NEW.cantidad < 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.almacen_id::text || NEW.insumo_id::text));
    SELECT COALESCE(sum(cantidad),0) INTO v_exist FROM movimientos_almacen
     WHERE almacen_id = NEW.almacen_id AND insumo_id = NEW.insumo_id;
    IF v_exist + NEW.cantidad < 0 THEN
      RAISE EXCEPTION 'Existencia insuficiente (% disponible, % solicitado)', v_exist, -NEW.cantidad;
    END IF;
  END IF;

  IF NEW.tipo = 'SALIDA_CONSUMO' THEN
    SELECT insumo_id INTO v_insumo_destino FROM lineas_control WHERE id = NEW.linea_control_id;
    IF v_insumo_destino <> NEW.insumo_id THEN
      RAISE EXCEPTION 'La línea de control destino no corresponde al insumo que sale';
    END IF;
    -- concepto que originalmente cargó el costo (última entrada de ese insumo)
    SELECT concepto_id, linea_control_id INTO v_origen FROM movimientos_almacen
     WHERE almacen_id = NEW.almacen_id AND insumo_id = NEW.insumo_id AND tipo = 'ENTRADA_OC'
     ORDER BY fecha DESC, id DESC LIMIT 1;
    IF v_origen.linea_control_id IS NOT NULL AND v_origen.linea_control_id <> NEW.linea_control_id THEN
      INSERT INTO mov_presupuestales(obra_id, concepto_id, linea_control_id, etapa, cantidad, importe, doc_tipo)
      VALUES (NEW.obra_id, v_origen.concepto_id, v_origen.linea_control_id, 'EJERCIDO',
              NEW.cantidad, round(NEW.cantidad * NEW.costo_unitario, 2), 'RECLASIF'),
             (NEW.obra_id, NEW.concepto_id, NEW.linea_control_id, 'EJERCIDO',
              -NEW.cantidad, -round(NEW.cantidad * NEW.costo_unitario, 2), 'RECLASIF');
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER movimientos_almacen_validar BEFORE INSERT ON movimientos_almacen
  FOR EACH ROW EXECUTE FUNCTION trg_mov_almacen();

-- =============================================================================
-- DESTAJOS: contrato -> compromiso; avance con foto -> estimación -> ejercido
-- =============================================================================
CREATE FUNCTION trg_contrato_destajo_estado() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l record; v record;
BEGIN
  IF NEW.estado = 'VIGENTE' AND OLD.estado = 'BORRADOR' THEN
    FOR l IN SELECT cl.*, lc.precio_vigente FROM contrato_destajo_lineas cl
               JOIN lineas_control lc ON lc.id = cl.linea_control_id
              WHERE cl.contrato_id = NEW.id ORDER BY cl.linea_control_id LOOP
      SELECT * INTO v FROM fn_validar_linea_requisicion(l.linea_control_id, l.cantidad_contratada, l.pu_destajo);
      IF v.resultado = 'ROJO' THEN
        RAISE EXCEPTION 'Contrato % excede el presupuesto de mano de obra del concepto: %', NEW.folio, v.detalle->'motivos';
      END IF;
      INSERT INTO mov_presupuestales(obra_id, concepto_id, linea_control_id, etapa, cantidad, importe, doc_tipo, doc_id, doc_linea_id)
      VALUES (l.obra_id, l.concepto_id, l.linea_control_id, 'COMPROMETIDO', l.cantidad_contratada,
              round(l.cantidad_contratada * l.pu_destajo, 2), 'CONTRATO', NEW.id, l.id);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contratos_destajo_estado BEFORE UPDATE OF estado ON contratos_destajo
  FOR EACH ROW EXECUTE FUNCTION trg_contrato_destajo_estado();

-- Validar avance: foto obligatoria, sin rebasar 100% del concepto, foto no reciclada
CREATE FUNCTION trg_avance_validar() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_acum numeric; v_vig numeric; v_fotos int; v_recicladas int;
BEGIN
  IF NEW.estado = 'VALIDADO' AND OLD.estado <> 'VALIDADO' THEN
    IF NEW.validado_por IS NULL OR NEW.validado_por = NEW.capturado_por THEN
      RAISE EXCEPTION 'Segregación de funciones: el avance lo valida alguien distinto a quien lo capturó';
    END IF;
    SELECT count(*) INTO v_fotos FROM evidencias e JOIN archivos a ON a.id = e.archivo_id
     WHERE e.entidad_tipo = 'AVANCE' AND e.entidad_id = NEW.id AND a.mime LIKE 'image/%';
    IF v_fotos = 0 THEN
      RAISE EXCEPTION 'Sin foto no hay avance: adjunte al menos una evidencia fotográfica';
    END IF;
    SELECT count(*) INTO v_recicladas
      FROM evidencias e JOIN archivos a ON a.id = e.archivo_id
     WHERE e.entidad_tipo = 'AVANCE' AND e.entidad_id = NEW.id
       AND EXISTS (SELECT 1 FROM archivos a2 JOIN evidencias e2 ON e2.archivo_id = a2.id
                    WHERE a2.sha256 = a.sha256 AND a2.id <> a.id
                      AND e2.entidad_tipo = 'AVANCE' AND e2.entidad_id <> NEW.id);
    IF v_recicladas > 0 THEN
      RAISE EXCEPTION 'Una de las fotos ya fue usada como evidencia de otro avance';
    END IF;
    SELECT COALESCE(sum(cantidad),0) INTO v_acum FROM avances
     WHERE concepto_id = NEW.concepto_id AND estado = 'VALIDADO' AND id <> NEW.id;
    SELECT cantidad_vigente INTO v_vig FROM conceptos WHERE id = NEW.concepto_id;
    IF v_acum + NEW.cantidad > v_vig THEN
      RAISE EXCEPTION 'El avance acumulado (% + %) rebasaría el volumen vigente del concepto (%). Requiere orden de cambio.',
                      v_acum, NEW.cantidad, v_vig;
    END IF;
    NEW.validado_en := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER avances_validar BEFORE UPDATE OF estado ON avances
  FOR EACH ROW EXECUTE FUNCTION trg_avance_validar();

-- Generación automática de la estimación semanal de un contrato de destajo
CREATE FUNCTION fn_generar_estimacion_destajo(p_contrato uuid, p_periodo_fin date)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  c record; v_id uuid; v_num int; v_ini date; v_subtotal numeric; v_amort numeric;
  v_saldo_anticipo numeric; v_fg numeric; v_deduct numeric;
BEGIN
  SELECT * INTO c FROM contratos_destajo WHERE id = p_contrato AND estado = 'VIGENTE' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato no vigente'; END IF;
  IF EXISTS (SELECT 1 FROM estimaciones_destajo WHERE contrato_id = p_contrato AND estado IN ('BORRADOR','REVISADA')) THEN
    RAISE EXCEPTION 'Existe una estimación abierta para este contrato; ciérrela antes de generar otra';
  END IF;

  SELECT COALESCE(max(numero),0) + 1, COALESCE(max(periodo_fin) + 1, p_periodo_fin - 6)
    INTO v_num, v_ini
    FROM estimaciones_destajo WHERE contrato_id = p_contrato AND estado <> 'CANCELADA';

  INSERT INTO estimaciones_destajo(obra_id, contrato_id, numero, periodo_inicio, periodo_fin)
  VALUES (c.obra_id, p_contrato, v_num, least(v_ini, p_periodo_fin), p_periodo_fin)
  RETURNING id INTO v_id;

  -- cantidad del periodo = min(avance validado acumulado, contratado) - ya estimado
  INSERT INTO estimacion_destajo_lineas(estimacion_id, contrato_linea_id, cantidad_anterior,
                                        cantidad_periodo, cantidad_acumulada, pu_destajo)
  SELECT v_id, cl.id, prev.cant,
         least(av.cant, cl.cantidad_contratada) - prev.cant,
         least(av.cant, cl.cantidad_contratada), cl.pu_destajo
    FROM contrato_destajo_lineas cl
    CROSS JOIN LATERAL (SELECT COALESCE(sum(a.cantidad),0) cant FROM avances a
                         WHERE a.contrato_linea_id = cl.id AND a.estado = 'VALIDADO'
                           AND a.fecha <= p_periodo_fin) av
    CROSS JOIN LATERAL (SELECT COALESCE(sum(el.cantidad_periodo),0) cant
                          FROM estimacion_destajo_lineas el JOIN estimaciones_destajo e ON e.id = el.estimacion_id
                         WHERE el.contrato_linea_id = cl.id AND e.estado <> 'CANCELADA' AND e.id <> v_id) prev
   WHERE cl.contrato_id = p_contrato
     AND least(av.cant, cl.cantidad_contratada) - prev.cant > 0;

  SELECT COALESCE(sum(importe),0) INTO v_subtotal FROM estimacion_destajo_lineas WHERE estimacion_id = v_id;

  -- amortización de anticipo (sin rebasar el saldo pendiente)
  SELECT c.monto_anticipo - COALESCE(sum(amortizacion_anticipo),0) INTO v_saldo_anticipo
    FROM estimaciones_destajo WHERE contrato_id = p_contrato AND estado <> 'CANCELADA' AND id <> v_id;
  v_amort := least(round(v_subtotal * c.pct_amortizacion / 100, 2), greatest(v_saldo_anticipo, 0));
  v_fg    := round(v_subtotal * c.pct_fondo_garantia / 100, 2);

  -- deductivas automáticas: material entregado con cargo al contratista aún no descontado
  INSERT INTO estimacion_deductivas(estimacion_id, descripcion, importe, movimiento_almacen_id)
  SELECT v_id, 'Material con cargo: ' || i.descripcion, round(-m.cantidad * m.costo_unitario, 2), m.id
    FROM movimientos_almacen m JOIN insumos i ON i.id = m.insumo_id
   WHERE m.obra_id = c.obra_id AND m.contratista_id = c.contratista_id AND m.cargo_a_contratista
     AND m.tipo = 'SALIDA_CONSUMO' AND m.fecha::date <= p_periodo_fin
     AND NOT EXISTS (SELECT 1 FROM estimacion_deductivas d WHERE d.movimiento_almacen_id = m.id);
  SELECT COALESCE(sum(importe),0) INTO v_deduct FROM estimacion_deductivas WHERE estimacion_id = v_id;

  UPDATE estimaciones_destajo
     SET subtotal = v_subtotal, amortizacion_anticipo = v_amort, retencion_fg = v_fg,
         deductivas = v_deduct, neto_a_pagar = v_subtotal - v_amort - v_fg - v_deduct
   WHERE id = v_id;
  RETURN v_id;
END $$;

-- Aprobación de estimación: compromiso -> ejercido (por el importe bruto)
CREATE FUNCTION trg_estimacion_estado() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado = 'APROBADA' AND OLD.estado <> 'APROBADA' THEN
    IF NEW.revisada_por IS NULL OR NEW.aprobada_por IS NULL OR NEW.revisada_por = NEW.aprobada_por THEN
      RAISE EXCEPTION 'La estimación requiere revisión (obra) y aprobación (finanzas) por personas distintas';
    END IF;
    INSERT INTO mov_presupuestales(obra_id, concepto_id, linea_control_id, etapa, cantidad, importe, doc_tipo, doc_id, doc_linea_id)
    SELECT cl.obra_id, cl.concepto_id, cl.linea_control_id, x.etapa, x.sg * el.cantidad_periodo, x.sg * el.importe,
           'EST', NEW.id, el.id
      FROM estimacion_destajo_lineas el
      JOIN contrato_destajo_lineas cl ON cl.id = el.contrato_linea_id
      CROSS JOIN (VALUES ('COMPROMETIDO'::etapa_presupuestal, -1), ('EJERCIDO'::etapa_presupuestal, 1)) x(etapa, sg)
     WHERE el.estimacion_id = NEW.id;
    NEW.aprobada_en := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER estimaciones_estado BEFORE UPDATE OF estado ON estimaciones_destajo
  FOR EACH ROW EXECUTE FUNCTION trg_estimacion_estado();

-- =============================================================================
-- PAGOS: prorratea lo pagado a las líneas de control (dimensión de flujo)
-- =============================================================================
CREATE FUNCTION trg_pago_aplicacion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_total numeric; v_aplicado numeric;
BEGIN
  IF NEW.estimacion_id IS NOT NULL THEN
    SELECT neto_a_pagar INTO v_total FROM estimaciones_destajo WHERE id = NEW.estimacion_id AND estado IN ('APROBADA','PAGADA');
    IF NOT FOUND THEN RAISE EXCEPTION 'Sólo se pagan estimaciones aprobadas'; END IF;
    SELECT COALESCE(sum(importe),0) INTO v_aplicado FROM pago_aplicaciones
     WHERE estimacion_id = NEW.estimacion_id AND id <> NEW.id;
    IF v_aplicado + NEW.importe > v_total + 0.01 THEN
      RAISE EXCEPTION 'Pago excede el neto de la estimación (% + % > %)', v_aplicado, NEW.importe, v_total;
    END IF;
    -- ratio sobre el neto -> se registra como pagado la parte proporcional del bruto
    INSERT INTO mov_presupuestales(obra_id, concepto_id, linea_control_id, etapa, importe, doc_tipo, doc_id, doc_linea_id)
    SELECT cl.obra_id, cl.concepto_id, cl.linea_control_id, 'PAGADO',
           round(el.importe * NEW.importe / NULLIF(v_total,0), 2), 'PAGO', NEW.pago_id, el.id
      FROM estimacion_destajo_lineas el JOIN contrato_destajo_lineas cl ON cl.id = el.contrato_linea_id
     WHERE el.estimacion_id = NEW.estimacion_id;
    IF v_aplicado + NEW.importe >= v_total - 0.01 THEN
      UPDATE estimaciones_destajo SET estado = 'PAGADA' WHERE id = NEW.estimacion_id;
    END IF;
  ELSE
    SELECT total INTO v_total FROM facturas WHERE id = NEW.factura_id AND estado IN ('VALIDADA','PROGRAMADA','PAGADA');
    IF NOT FOUND THEN RAISE EXCEPTION 'Sólo se pagan facturas validadas (conciliadas contra OC y recepción)'; END IF;
    SELECT COALESCE(sum(importe),0) INTO v_aplicado FROM pago_aplicaciones
     WHERE factura_id = NEW.factura_id AND id <> NEW.id;
    IF v_aplicado + NEW.importe > v_total + 0.01 THEN
      RAISE EXCEPTION 'Pago excede el saldo de la factura';
    END IF;
    INSERT INTO mov_presupuestales(obra_id, concepto_id, linea_control_id, etapa, importe, doc_tipo, doc_id, doc_linea_id)
    SELECT ol.obra_id, ol.concepto_id, ol.linea_control_id, 'PAGADO',
           round(fl.importe * NEW.importe / NULLIF(v_total,0), 2), 'PAGO', NEW.pago_id, ol.id
      FROM factura_lineas_oc fl JOIN oc_lineas ol ON ol.id = fl.oc_linea_id
     WHERE fl.factura_id = NEW.factura_id;
    IF v_aplicado + NEW.importe >= v_total - 0.01 THEN
      UPDATE facturas SET estado = 'PAGADA' WHERE id = NEW.factura_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pago_aplicaciones_aplicar AFTER INSERT ON pago_aplicaciones
  FOR EACH ROW EXECUTE FUNCTION trg_pago_aplicacion();

-- Conciliación de 3 vías: no se factura más de lo recibido
CREATE FUNCTION trg_factura_linea_oc() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ol record; v_fact numeric;
BEGIN
  SELECT * INTO ol FROM oc_lineas WHERE id = NEW.oc_linea_id;
  SELECT COALESCE(sum(cantidad),0) INTO v_fact FROM factura_lineas_oc WHERE oc_linea_id = NEW.oc_linea_id;
  IF v_fact + NEW.cantidad > ol.cantidad_recibida + 0.0001 THEN
    RAISE EXCEPTION 'Se factura % pero sólo se ha recibido % (ya facturado %)', NEW.cantidad, ol.cantidad_recibida, v_fact;
  END IF;
  IF NEW.importe > round(NEW.cantidad * ol.precio_unitario, 2) + 0.01 THEN
    RAISE EXCEPTION 'Precio facturado mayor al de la OC';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER factura_lineas_oc_validar BEFORE INSERT ON factura_lineas_oc
  FOR EACH ROW EXECUTE FUNCTION trg_factura_linea_oc();

-- =============================================================================
-- KPIs (vistas para el dashboard ejecutivo)
-- =============================================================================

-- Por concepto: físico vs financiero
CREATE VIEW v_kpi_concepto AS
SELECT c.obra_id, c.id AS concepto_id, c.clave, c.descripcion, c.importe_costo_vigente AS bac,
       av.pct_fisico,
       round(c.importe_costo_vigente * av.pct_fisico / 100, 2) AS ev,
       COALESCE(sum(s.imp_ejercido),0)     AS ac,
       COALESCE(sum(s.imp_comprometido),0) AS comprometido,
       COALESCE(sum(s.imp_pagado),0)       AS pagado,
       CASE WHEN c.importe_costo_vigente > 0
            THEN round(100 * COALESCE(sum(s.imp_ejercido),0) / c.importe_costo_vigente, 2) ELSE 0 END AS pct_financiero,
       CASE WHEN COALESCE(sum(s.imp_ejercido),0) > 0
            THEN round(c.importe_costo_vigente * av.pct_fisico / 100 / sum(s.imp_ejercido), 3) END AS cpi
  FROM conceptos c
  JOIN v_avance_concepto av ON av.concepto_id = c.id
  LEFT JOIN v_saldo_linea_control s ON s.concepto_id = c.id
 GROUP BY c.id, av.pct_fisico;

-- Valor planeado a la fecha
CREATE VIEW v_pv_obra AS
SELECT c.obra_id, sum(c.importe_costo_vigente * COALESCE(p.pct, 0) / 100) AS pv
  FROM conceptos c
  LEFT JOIN LATERAL (SELECT pct_planeado_acum pct FROM programa_obra po
                      WHERE po.concepto_id = c.id AND po.semana <= current_date
                      ORDER BY semana DESC LIMIT 1) p ON true
 GROUP BY c.obra_id;

CREATE VIEW v_kpi_obra AS
SELECT o.id AS obra_id, o.nombre, o.monto_contrato,
       sum(k.bac) AS bac, sum(k.ev) AS ev, sum(k.ac) AS ac, pv.pv,
       sum(k.comprometido) AS comprometido, sum(k.pagado) AS pagado,
       round(100 * sum(k.ev) / NULLIF(sum(k.bac),0), 2) AS pct_avance_fisico,
       round(100 * sum(k.ac) / NULLIF(sum(k.bac),0), 2) AS pct_avance_financiero,
       round(sum(k.ev) / NULLIF(sum(k.ac),0), 3) AS cpi,
       round(sum(k.ev) / NULLIF(pv.pv,0), 3)     AS spi,
       -- EAC = AC + (BAC - EV)/CPI  (supone que la eficiencia actual se mantiene)
       round(sum(k.ac) + (sum(k.bac) - sum(k.ev)) / NULLIF(sum(k.ev) / NULLIF(sum(k.ac),0),0), 2) AS eac,
       o.monto_contrato - round(sum(k.ac) + (sum(k.bac) - sum(k.ev)) / NULLIF(sum(k.ev) / NULLIF(sum(k.ac),0),0), 2)
         AS margen_proyectado
  FROM obras o
  JOIN v_kpi_concepto k ON k.obra_id = o.id
  LEFT JOIN v_pv_obra pv ON pv.obra_id = o.id
 GROUP BY o.id, pv.pv;

-- Destajo: lo pagado/estimado vs. avance validado (detecta pagos adelantados)
CREATE VIEW v_brecha_destajo AS
SELECT cd.obra_id, cd.id AS contrato_id, cd.folio, p.razon_social AS contratista,
       sum(cl.cantidad_contratada * cl.pu_destajo) AS monto_contrato,
       COALESCE(sum(est.imp),0) AS estimado,
       COALESCE(sum(av.cant * cl.pu_destajo),0) AS avance_valorizado,
       COALESCE(sum(est.imp),0) - COALESCE(sum(least(av.cant, cl.cantidad_contratada) * cl.pu_destajo),0) AS brecha
  FROM contratos_destajo cd
  JOIN proveedores p ON p.id = cd.contratista_id
  JOIN contrato_destajo_lineas cl ON cl.contrato_id = cd.id
  LEFT JOIN LATERAL (SELECT sum(a.cantidad) cant FROM avances a
                      WHERE a.contrato_linea_id = cl.id AND a.estado = 'VALIDADO') av ON true
  LEFT JOIN LATERAL (SELECT sum(el.importe) imp FROM estimacion_destajo_lineas el
                       JOIN estimaciones_destajo e ON e.id = el.estimacion_id
                      WHERE el.contrato_linea_id = cl.id AND e.estado IN ('APROBADA','PAGADA')) est ON true
 GROUP BY cd.id, p.razon_social;

-- Fondo de garantía retenido por contrato
CREATE VIEW v_fondo_garantia AS
SELECT cd.id AS contrato_id, cd.obra_id, cd.folio,
       COALESCE((SELECT sum(retencion_fg) FROM estimaciones_destajo e
                  WHERE e.contrato_id = cd.id AND e.estado IN ('APROBADA','PAGADA')),0) AS retenido,
       COALESCE((SELECT sum(importe) FROM fondo_garantia_liberaciones l WHERE l.contrato_id = cd.id),0) AS liberado
  FROM contratos_destajo cd;

-- =============================================================================
-- Multi-tenant: Row Level Security por empresa (la API fija oc.empresa_id por request)
-- =============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['usuarios','obras','insumos','proveedores','archivos','requisiciones',
                           'ordenes_compra','facturas','pagos']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_%1$s ON %1$I
                     USING (empresa_id = current_setting('oc.empresa_id', true)::uuid)$p$, t);
  END LOOP;
END $$;
-- Tablas hijas sin empresa_id se protegen por obra
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['partidas','conceptos','lineas_control','almacenes','movimientos_almacen',
                           'contratos_destajo','avances','estimaciones_destajo','mov_presupuestales','alertas']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_%1$s ON %1$I USING (obra_id IN
                     (SELECT id FROM obras WHERE empresa_id = current_setting('oc.empresa_id', true)::uuid))$p$, t);
  END LOOP;
END $$;
-- Nota: el owner de las tablas (migraciones) no está sujeto a RLS. La API se
-- conecta con un rol sin BYPASSRLS y ejecuta SET LOCAL oc.empresa_id = '<uuid>'.

