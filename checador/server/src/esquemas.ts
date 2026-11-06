// Validación de entradas (zod). Los mensajes se muestran tal cual al usuario.
import { z } from 'zod';

const id = z.guid('Identificador inválido');
const fechaHora = z.iso.datetime({ offset: true, message: 'Fecha y hora inválidas' });
const fecha = z.iso.date('Fecha inválida');
export const Tipo = z.enum(['ENTRADA', 'INICIO_DESCANSO', 'FIN_DESCANSO', 'SALIDA']);
export const Modalidad = z.enum(['LUGAR_FIJO', 'DESDE_CASA', 'MOVIL', 'KIOSCO']);
export const Rol = z.enum(['ADMIN', 'RH', 'SUPERVISOR', 'TRABAJADOR']);
const pin = z.string().regex(/^\d{4,6}$/, 'El PIN son de 4 a 6 dígitos');
/** Foto en base64 (la app la reduce a ~480 px; unos 30–60 KB). El tipo real se revisa por su contenido. */
export const Foto = z.object({ base64: z.string().min(1300).max(540_000, 'Foto demasiado grande') });
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const dias = z.array(z.number().int().min(1).max(7)).max(7);

export const Login = z.object({ email: z.email('Correo inválido'), password: z.string().min(1, 'Escriba su contraseña').max(200) });
export const CambiarEmpresa = z.object({ empresa_id: id });
export const CambiarPassword = z.object({
  actual: z.string().min(1).max(200),
  nueva: z.string().min(8, 'Mínimo 8 caracteres').max(200),
});

export const Checar = z.object({
  tipo: Tipo,
  modalidad: Modalidad.exclude(['KIOSCO']),
  ocurrido_en: fechaHora.optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  precision_m: z.number().nonnegative().max(100000).optional(),
  client_uuid: id.optional(),
  foto: Foto.optional(),
  enviado_en: fechaHora.optional(),
}).refine((c) => (c.lat === undefined) === (c.lng === undefined), { message: 'Ubicación incompleta', path: ['lat'] });

export const Lote = z.object({
  checadas: z.array(z.object({
    tipo: Tipo,
    modalidad: Modalidad.exclude(['KIOSCO']),
    ocurrido_en: fechaHora,
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    precision_m: z.number().nonnegative().max(100000).optional(),
    client_uuid: id,
    foto: Foto.optional(),
  })).min(1).max(60),
  /** reloj del teléfono al enviar: con él se corrige un reloj adelantado o atrasado */
  enviado_en: fechaHora.optional(),
});

export const Kiosco = z.object({
  numero: z.string().trim().min(1, 'Escriba su número').max(12),
  pin,
  tipo: Tipo.optional(),
  client_uuid: id.optional(),
  foto: Foto.optional(),
});
export const ActivarKiosco = z.object({ centro_id: id, nombre: z.string().trim().min(2).max(60) });

export const Correccion = z.object({
  trabajador_id: id,
  tipo: Tipo,
  ocurrido_en: fechaHora,
  motivo: z.string().trim().min(5, 'Escriba el motivo (mínimo 5 letras)').max(500),
});
export const Anular = z.object({ motivo: z.string().trim().min(5, 'Escriba el motivo (mínimo 5 letras)').max(500) });

const horaEntrada = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora en formato HH:MM').nullable();
export const NuevoTrabajador = z.object({
  numero: z.string().trim().regex(/^[0-9A-Za-z-]{1,12}$/, 'Número: hasta 12 letras, dígitos o guiones'),
  nombre: z.string().trim().min(2).max(120),
  puesto: z.string().trim().max(80).optional(),
  centro_id: id.nullable().optional(),
  modalidades: z.array(Modalidad).min(1, 'Elija al menos una forma de checar').max(4),
  hora_entrada: horaEntrada.optional(),
  jornada_min: z.number().int().min(60).max(1440).default(480),
  pin: pin.optional(),
  dias_remotos: dias.optional(),
});
const CasaRh = z.object({ lat, lng, radio_m: z.number().int().min(30).max(1000).default(150),
  direccion: z.string().trim().max(200).nullable().optional() });
export const EditarTrabajador = NuevoTrabajador.omit({ numero: true }).partial().extend({
  activo: z.boolean().optional(),
  desbloquear: z.boolean().optional(),
  /** RH fija o corrige la casa (queda aprobada); null la borra */
  casa: CasaRh.nullable().optional(),
  /** RH aprueba la casa que propuso el trabajador */
  aprobar_casa: z.boolean().optional(),
});
/** El trabajador propone su casa desde su celular, estando en ella. */
export const MiCasa = z.object({ lat, lng, precision_m: z.number().nonnegative().max(100000),
  direccion: z.string().trim().min(5, 'Escribe tu dirección').max(200) });

export const NuevoCentro = z.object({
  clave: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,12}$/, 'Clave: hasta 12 letras o dígitos'),
  nombre: z.string().trim().min(2).max(120),
  direccion: z.string().trim().max(200).optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  radio_m: z.number().int().min(10).max(5000).default(150),
}).refine((c) => (c.lat == null) === (c.lng == null), { message: 'Latitud y longitud van juntas', path: ['lat'] });
export const EditarCentro = z.object({
  nombre: z.string().trim().min(2).max(120).optional(),
  direccion: z.string().trim().max(200).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  radio_m: z.number().int().min(10).max(5000).optional(),
  activo: z.boolean().optional(),
});

export const NuevoUsuario = z.object({
  email: z.email('Correo inválido'),
  nombre: z.string().trim().min(2).max(120),
  rol: Rol,
  trabajador_id: id.optional(),
  /** sólo si la cuenta es nueva; si ya existe (otra empresa del grupo) conserva su contraseña */
  password: z.string().min(8, 'Contraseña de mínimo 8 caracteres').max(200).optional(),
}).refine((u) => u.rol !== 'TRABAJADOR' || u.trabajador_id, { message: 'Elija la ficha del trabajador', path: ['trabajador_id'] });
export const EditarUsuario = z.object({ rol: Rol.optional(), activa: z.boolean().optional() });

export const NuevoPeriodo = z.object({ nombre: z.string().trim().min(3).max(80), inicio: fecha, fin: fecha })
  .refine((p) => p.fin >= p.inicio, { message: 'El fin no puede ser antes del inicio', path: ['fin'] });
export const Respuesta = z.object({ acepta: z.boolean(), comentario: z.string().trim().max(1000).optional() })
  .refine((r) => r.acepta || (r.comentario?.length ?? 0) >= 5, { message: 'Explique qué no coincide', path: ['comentario'] });

export const FechaQuery = z.object({ fecha: fecha.optional() });
export const BitacoraQuery = z.object({ fecha: fecha.optional(), trabajador_id: id.optional() });
