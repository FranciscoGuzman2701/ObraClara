// Tipos de las respuestas del API. La web los importa (sólo tipos) desde aquí.
export type Rol = 'ADMIN' | 'RH' | 'SUPERVISOR' | 'TRABAJADOR';
export type TipoChecada = 'ENTRADA' | 'INICIO_DESCANSO' | 'FIN_DESCANSO' | 'SALIDA';
export type Modalidad = 'LUGAR_FIJO' | 'DESDE_CASA' | 'MOVIL' | 'KIOSCO';
export type Incidencia = 'FUERA_DE_ZONA' | 'SIN_UBICACION' | 'SECUENCIA' | 'RETARDO'
  | 'FUERA_DE_CASA' | 'CASA_SIN_APROBAR' | 'DIA_NO_REMOTO' | 'ENVIO_DIFERIDO';
/** Además de las de las checadas, el tablero avisa de quien no ha llegado a su hora. */
export type Alerta = Incidencia | 'NO_HA_LLEGADO';
export type EstadoAsistencia = 'TRABAJANDO' | 'EN_DESCANSO' | 'SALIO' | 'SIN_REGISTRO';

export interface EmpresaAcceso { id: string; clave: string; nombre: string; rol: Rol; actual: boolean }

export interface InfoSesion {
  token?: string;
  cuenta: { id: string; nombre: string; email: string };
  empresa: { id: string; clave: string; nombre: string; zona_horaria: string };
  rol: Rol;
  trabajador: { id: string; numero: string; nombre: string; modalidades: Modalidad[]; centro: string | null } | null;
  empresas: EmpresaAcceso[];
}

export interface ChecadaVista {
  id: string;
  tipo: TipoChecada;
  ocurrido_en: string;
  medio: 'CELULAR' | 'KIOSCO' | 'SUPERVISOR';
  modalidad: Modalidad | null;
  centro: string | null;
  incidencias: Incidencia[];
  distancia_m: number | null;
  nota: string | null;
  anulada: boolean;
  recibido_en: string;
  foto_id: string | null;
}

export interface Casa { lat: number; lng: number; radio_m: number; direccion: string | null; estado: 'PROPUESTA' | 'APROBADA' }

export interface MiDia {
  trabajador: NonNullable<InfoSesion['trabajador']> & { centro_lat: number | null; centro_lng: number | null; radio_m: number | null;
    casa: Casa | null; dias_remotos: number[] };
  /** la empresa pide selfie al checar desde casa o en movimiento */
  foto_obligatoria: boolean;
  fecha: string;
  siguientes: TipoChecada[];
  bitacora: ChecadaVista[];
  minutos_hoy: number;
}

export interface ChecadaRegistrada {
  id: string;
  trabajador: string;
  tipo: TipoChecada;
  ocurrido_en: string;
  incidencias: Incidencia[];
  distancia_m: number | null;
  duplicado: boolean;
}

export interface ResultadoLote { client_uuid: string; estado: 'ACEPTADA' | 'DUPLICADA' | 'RECHAZADA'; id?: string; motivo?: string }

export interface FilaEquipo {
  trabajador_id: string;
  numero: string;
  nombre: string;
  puesto: string | null;
  centro: string | null;
  estado: EstadoAsistencia;
  ultima_checada: string | null;
  modalidad: Modalidad | null;
  minutos_hoy: number;
  alertas: Alerta[];
}

export interface Tablero {
  empresa: { id: string; clave: string; nombre: string };
  fecha: string;
  es_hoy: boolean;
  resumen: { trabajando: number; en_descanso: number; salieron: number; sin_registro: number; requieren_atencion: number; total: number };
  casas_por_aprobar: { trabajador_id: string; nombre: string }[];
  equipo: FilaEquipo[];
  incidencias: { checada_id: string; trabajador: string; tipo: TipoChecada; ocurrido_en: string; incidencias: Incidencia[];
                 distancia_m: number | null }[];
}

export type ResumenEmpresa = Tablero['resumen'] & { id: string; clave: string; nombre: string; rol: Rol };

export interface Trabajador {
  id: string; numero: string; nombre: string; puesto: string | null; centro_id: string | null; centro: string | null;
  modalidades: Modalidad[]; hora_entrada: string | null; jornada_min: number; tiene_pin: boolean; bloqueado: boolean;
  cuenta_email: string | null; activo: boolean; dias_remotos: number[]; casa: Casa | null; casa_actualizada_en: string | null;
}

export interface Centro { id: string; clave: string; nombre: string; direccion: string | null; lat: number | null;
  lng: number | null; radio_m: number; activo: boolean }

export interface Dispositivo { id: string; nombre: string; centro: string; creado_en: string; ultimo_uso: string | null;
  revocado_en: string | null }

export interface Usuario { cuenta_id: string; nombre: string; email: string; rol: Rol; trabajador: string | null; activa: boolean }

export interface Periodo { id: string; nombre: string; inicio: string; fin: string; estado: 'ABIERTO' | 'CERRADO';
  cerrado_en: string | null; trabajadores: number; aceptados: number; objetados: number }

export interface FilaPeriodo {
  trabajador_id: string; numero: string; nombre: string; horas: number; dias_trabajados: number; retardos: number;
  incidencias: number; correcciones: number; jornadas_abiertas: number; respuesta: 'ACEPTADO' | 'OBJETADO' | null;
  comentario: string | null; respondido_en: string | null;
}

export interface MiPeriodo extends Omit<FilaPeriodo, 'trabajador_id' | 'numero' | 'nombre'> {
  id: string; nombre: string; inicio: string; fin: string;
}
