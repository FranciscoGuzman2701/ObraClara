// Contratos compartidos de ObraClara. La API valida con estos esquemas y la
// web / app de campo los usan para tipar peticiones y respuestas.
import { z } from 'zod';

// z.guid(): acepta cualquier UUID con formato 8-4-4-4-12 (Postgres no exige versión RFC)
export const uuid = z.guid();
const cantidad = z.number().positive().max(1e12);
const dinero = z.number().nonnegative().max(1e12);

// ----------------------------------------------------------------- catálogos
export const Rol = z.enum(['ADMIN', 'DIRECTOR', 'GERENTE_OBRA', 'RESIDENTE', 'CABO', 'COMPRAS', 'ALMACEN', 'FINANZAS']);
export type Rol = z.infer<typeof Rol>;

export const Semaforo = z.enum(['VERDE', 'AMARILLO', 'ROJO']);
export type Semaforo = z.infer<typeof Semaforo>;

// ----------------------------------------------------------------- auth
export const DevLoginInput = z.object({ email: z.email() });
export type DevLoginInput = z.infer<typeof DevLoginInput>;

export interface SesionUsuario {
  token: string;
  usuario: { id: string; nombre: string; email: string; empresa_id: string };
}

// ----------------------------------------------------------------- presupuesto
export interface LineaControlSaldo {
  linea_control_id: string;
  insumo_clave: string;
  insumo_descripcion: string;
  insumo_tipo: string;
  unidad: string;
  cantidad_vigente: number;
  precio_vigente: number;
  importe_vigente: number;
  imp_reservado: number;
  imp_comprometido: number;
  imp_ejercido: number;
  imp_pagado: number;
  cant_disponible: number;
  imp_disponible: number;
}

export interface ConceptoPresupuesto {
  concepto_id: string;
  partida_clave: string;
  partida_descripcion: string;
  clave: string;
  descripcion: string;
  unidad: string;
  cantidad_vigente: number;
  importe_costo_vigente: number;
  pct_fisico: number;
  pct_financiero: number;
  lineas: LineaControlSaldo[];
}

export interface KpiObra {
  obra_id: string;
  nombre: string;
  monto_contrato: number | null;
  bac: number;
  ev: number;
  ac: number;
  pv: number | null;
  comprometido: number;
  pagado: number;
  pct_avance_fisico: number | null;
  pct_avance_financiero: number | null;
  cpi: number | null;
  spi: number | null;
  eac: number | null;
  margen_proyectado: number | null;
}

export interface ObraResumen {
  id: string;
  clave: string;
  nombre: string;
  cliente: string | null;
  monto_contrato: number | null;
  presupuesto_estado: 'BORRADOR' | 'AUTORIZADO';
  roles: Rol[];
}

// ----------------------------------------------------------------- requisiciones
export const LineaRequisicionInput = z.object({
  linea_control_id: uuid,
  cantidad,
  precio_estimado: dinero,
  justificacion: z.string().trim().min(5).max(2000).optional(),
});
export type LineaRequisicionInput = z.infer<typeof LineaRequisicionInput>;

export const ValidarLineaInput = LineaRequisicionInput.pick({
  linea_control_id: true,
  cantidad: true,
  precio_estimado: true,
});
export type ValidarLineaInput = z.infer<typeof ValidarLineaInput>;

export interface ResultadoValidacion {
  resultado: Semaforo;
  detalle: {
    cantidad_vigente: number;
    cantidad_disponible: number;
    importe_vigente: number;
    importe_disponible: number;
    pct_consumo_cantidad: number;
    pct_consumo_importe: number;
    pct_desvio_precio: number;
    pct_avance_fisico: number;
    motivos: string[];
  };
}

export const CrearRequisicionInput = z.object({
  obra_id: uuid,
  client_uuid: uuid.optional(),
  fecha_requerida: z.iso.date().optional(),
  lineas: z.array(LineaRequisicionInput).min(1).max(200),
});
export type CrearRequisicionInput = z.infer<typeof CrearRequisicionInput>;

export const AutorizarExcepcionInput = z.object({
  requisicion_linea_id: uuid,
  justificacion: z.string().trim().min(5).max(2000),
});

// ----------------------------------------------------------------- avances
export const CrearAvanceInput = z.object({
  concepto_id: uuid,
  contrato_linea_id: uuid.optional(),
  cantidad,
  fecha: z.iso.date(),
  ubicacion_texto: z.string().max(200).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});
export type CrearAvanceInput = z.infer<typeof CrearAvanceInput>;

// ----------------------------------------------------------------- sincronización offline
// La app de campo no edita registros compartidos: envía COMANDOS idempotentes
// (client_uuid) y el servidor responde aceptado/rechazado con motivo.
const ComandoBase = z.object({
  client_uuid: uuid,
  obra_id: uuid,
  creado_en: z.iso.datetime({ offset: true }),
});

export const ComandoSync = z.discriminatedUnion('tipo', [
  ComandoBase.extend({ tipo: z.literal('AVANCE_CREAR'), payload: CrearAvanceInput }),
  ComandoBase.extend({
    tipo: z.literal('REQUISICION_CREAR'),
    payload: CrearRequisicionInput.omit({ obra_id: true, client_uuid: true }),
  }),
]);
export type ComandoSync = z.infer<typeof ComandoSync>;
export type TipoComando = ComandoSync['tipo'];

export const PushInput = z.object({ comandos: z.array(ComandoSync).min(1).max(100) });
export type PushInput = z.infer<typeof PushInput>;

export type EstadoComando = 'ACEPTADO' | 'DUPLICADO' | 'RECHAZADO';
export interface ResultadoComando {
  client_uuid: string;
  estado: EstadoComando;
  id?: string;
  motivo?: string;
}

/** Réplica de lectura que la app guarda en SQLite para trabajar sin señal. */
export interface SnapshotObra {
  obra: {
    id: string; clave: string; nombre: string; lat: number | null; lng: number | null; radio_geocerca_m: number;
    tol_amarillo_pct: number; tol_rojo_pct: number; tol_precio_pct: number; tol_anticipo_pts: number;
  };
  roles: Rol[];
  conceptos: ConceptoPresupuesto[];
  /** Líneas de contratos de destajo vigentes, para ligar avances al destajista. */
  contratos: { contrato_linea_id: string; contrato_folio: string; contratista: string; concepto_id: string;
               cantidad_contratada: number }[];
  /** Estado de lo que este usuario capturó en los últimos 30 días. */
  mis_documentos: { client_uuid: string; tipo: 'AVANCE' | 'REQUISICION'; id: string; estado: string; folio: string | null }[];
  generado_en: string;
}

// ----------------------------------------------------------------- archivos
export const PrefirmarInput = z.object({
  obra_id: uuid,
  mime: z.enum(['image/jpeg', 'image/png', 'image/heic', 'application/pdf', 'application/xml', 'text/xml']),
  bytes: z.number().int().positive().max(25 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type PrefirmarInput = z.infer<typeof PrefirmarInput>;

export const ConfirmarArchivoInput = z.object({
  archivo_id: uuid,
  entidad_tipo: z.enum(['AVANCE', 'RECEPCION', 'REQUISICION', 'MOV_ALMACEN', 'ESTIMACION', 'FACTURA', 'PAGO', 'COTIZACION']),
  entidad_id: uuid,
  tomada_en: z.iso.datetime({ offset: true }).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});
export type ConfirmarArchivoInput = z.infer<typeof ConfirmarArchivoInput>;

export * from './semaforo';
