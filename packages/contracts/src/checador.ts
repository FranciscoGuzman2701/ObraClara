// Checador digital: contratos compartidos entre API, panel web y app de campo.
// Cada empresa lleva su propio registro; el token de sesión fija la empresa.
import { z } from 'zod';

const id = z.guid();
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

export const TipoChecada = z.enum(['ENTRADA', 'INICIO_DESCANSO', 'FIN_DESCANSO', 'SALIDA']);
export type TipoChecada = z.infer<typeof TipoChecada>;

/** LUGAR_FIJO = geocerca del centro · DESDE_CASA = home office · MOVIL = visitas · KIOSCO = tableta compartida */
export const ModalidadChecada = z.enum(['LUGAR_FIJO', 'DESDE_CASA', 'MOVIL', 'KIOSCO']);
export type ModalidadChecada = z.infer<typeof ModalidadChecada>;

export const Incidencia = z.enum(['FUERA_DE_ZONA', 'SIN_UBICACION', 'SECUENCIA']);
export type Incidencia = z.infer<typeof Incidencia>;

/** Misma tabla que oc.siguientes_checada() en la base. */
export function siguientesChecada(ultimo: TipoChecada | null): TipoChecada[] {
  switch (ultimo) {
    case 'ENTRADA':
    case 'FIN_DESCANSO':
      return ['INICIO_DESCANSO', 'SALIDA'];
    case 'INICIO_DESCANSO':
      return ['FIN_DESCANSO'];
    default:
      return ['ENTRADA'];
  }
}

export const ETIQUETA_CHECADA: Record<TipoChecada, string> = {
  ENTRADA: 'Entrada',
  INICIO_DESCANSO: 'Descanso',
  FIN_DESCANSO: 'Regreso de descanso',
  SALIDA: 'Salida',
};

// ----------------------------------------------------------------- sesión multi-empresa
export interface EmpresaAcceso {
  id: string;
  clave: string | null;
  nombre: string;
  actual: boolean;
}

export const CambiarEmpresaInput = z.object({ empresa_id: id });
export type CambiarEmpresaInput = z.infer<typeof CambiarEmpresaInput>;

// ----------------------------------------------------------------- checar
/** Checada desde el celular del propio trabajador. */
export const ChecadaInput = z.object({
  tipo: TipoChecada,
  modalidad: ModalidadChecada.exclude(['KIOSCO']),
  /** Hora en que se tocó el botón; si no hay señal la app la guarda y la manda después. */
  ocurrido_en: z.iso.datetime({ offset: true }).optional(),
  centro_id: id.optional(),
  lat: lat.optional(),
  lng: lng.optional(),
  precision_m: z.number().nonnegative().max(10000).optional(),
  nota: z.string().trim().max(300).optional(),
  client_uuid: id.optional(),
});
export type ChecadaInput = z.infer<typeof ChecadaInput>;

export const LoteChecadasInput = z.object({
  checadas: z.array(ChecadaInput.extend({ client_uuid: id, ocurrido_en: z.iso.datetime({ offset: true }) }))
    .min(1).max(100),
});
export type LoteChecadasInput = z.infer<typeof LoteChecadasInput>;

/** Kiosco compartido: número de trabajador + PIN. */
export const KioscoChecadaInput = z.object({
  numero: z.string().trim().min(1).max(20),
  pin: z.string().regex(/^\d{4,8}$/, 'El PIN son de 4 a 8 dígitos'),
  tipo: TipoChecada.optional(), // si se omite, se usa la siguiente lógica (entrada → salida…)
  centro_id: id.optional(),
  client_uuid: id.optional(),
  ocurrido_en: z.iso.datetime({ offset: true }).optional(),
});
export type KioscoChecadaInput = z.infer<typeof KioscoChecadaInput>;

/** Captura de supervisor (olvidó checar, falla del teléfono…). Siempre con motivo. */
export const CorreccionInput = z.object({
  trabajador_id: id,
  tipo: TipoChecada,
  ocurrido_en: z.iso.datetime({ offset: true }),
  motivo: z.string().trim().min(5).max(500),
});
export type CorreccionInput = z.infer<typeof CorreccionInput>;

export const AnularChecadaInput = z.object({ motivo: z.string().trim().min(5).max(500) });

export interface ChecadaRegistrada {
  id: string;
  trabajador: string;
  tipo: TipoChecada;
  ocurrido_en: string;
  incidencias: Incidencia[];
  duplicado: boolean;
}

// ----------------------------------------------------------------- catálogos
export const CrearCentroInput = z.object({
  clave: z.string().trim().min(1).max(20),
  nombre: z.string().trim().min(2).max(120),
  obra_id: id.optional(),
  lat: lat.optional(),
  lng: lng.optional(),
  radio_m: z.number().int().min(10).max(5000).default(150),
}).refine((c) => (c.lat === undefined) === (c.lng === undefined), { message: 'lat y lng van juntos', path: ['lat'] });
export type CrearCentroInput = z.infer<typeof CrearCentroInput>;

export const CrearTrabajadorInput = z.object({
  numero: z.string().trim().min(1).max(20),
  nombre: z.string().trim().min(2).max(120),
  centro_id: id.optional(),
  modalidades: z.array(ModalidadChecada).min(1).max(4),
  jornada_min: z.number().int().min(60).max(1440).default(480),
  /** Correo de un usuario de ESTA empresa, si va a checar desde su celular. */
  usuario_email: z.email().optional(),
  pin: z.string().regex(/^\d{4,8}$/).optional(),
});
export type CrearTrabajadorInput = z.infer<typeof CrearTrabajadorInput>;

// ----------------------------------------------------------------- tablero
export type EstadoAsistencia = 'TRABAJANDO' | 'EN_DESCANSO' | 'SALIO' | 'SIN_REGISTRO';

export interface FilaAsistencia {
  trabajador_id: string;
  numero: string;
  nombre: string;
  centro: string | null;
  estado: EstadoAsistencia;
  ultima_checada: string | null;
  modalidad: ModalidadChecada | null;
  incidencias: Incidencia[];
}

export interface TableroAsistencia {
  empresa: { id: string; clave: string | null; nombre: string };
  fecha: string;
  resumen: { trabajando: number; en_descanso: number; salieron: number; sin_registro: number; requieren_atencion: number };
  trabajadores: FilaAsistencia[];
  incidencias: { checada_id: string; trabajador: string; tipo: TipoChecada; ocurrido_en: string; incidencias: Incidencia[];
                 distancia_m: number | null }[];
}

/** Vista del dueño: una fila por empresa del grupo, cada una con su propio registro. */
export interface ResumenGrupo {
  empresas: ({ id: string; clave: string | null; nombre: string } & TableroAsistencia['resumen'])[];
}

// ----------------------------------------------------------------- periodos
export const CrearPeriodoInput = z.object({
  nombre: z.string().trim().min(3).max(80),
  inicio: z.iso.date(),
  fin: z.iso.date(),
}).refine((p) => p.fin >= p.inicio, { message: 'El fin no puede ser antes del inicio', path: ['fin'] });
export type CrearPeriodoInput = z.infer<typeof CrearPeriodoInput>;

export const RespuestaPeriodoInput = z.object({
  acepta: z.boolean(),
  comentario: z.string().trim().max(1000).optional(),
}).refine((r) => r.acepta || (r.comentario?.length ?? 0) >= 5, {
  message: 'Explique qué no coincide', path: ['comentario'],
});
export type RespuestaPeriodoInput = z.infer<typeof RespuestaPeriodoInput>;

export interface PeriodoResumen {
  id: string;
  nombre: string;
  inicio: string;
  fin: string;
  estado: 'ABIERTO' | 'CERRADO';
  trabajadores: number;
  aceptados: number;
  objetados: number;
}

export interface PeriodoTrabajador {
  trabajador_id: string;
  numero: string;
  nombre: string;
  horas: number;
  dias_trabajados: number;
  incidencias: number;
  correcciones: number;
  jornadas_abiertas: number;
  respuesta: 'ACEPTADO' | 'OBJETADO' | null;
  comentario: string | null;
}
