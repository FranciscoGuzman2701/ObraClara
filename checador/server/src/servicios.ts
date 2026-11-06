import type { Cliente } from './db.js';
import { HttpError } from './errores.js';
import type { ChecadaRegistrada, ChecadaVista, Modalidad, Tablero, TipoChecada } from './tipos.js';

export interface NuevaChecada {
  trabajadorId: string;
  tipo: TipoChecada;
  medio: 'CELULAR' | 'KIOSCO' | 'SUPERVISOR';
  modalidad: Modalidad | null;
  ocurrido_en?: string;
  centro_id?: string;
  lat?: number;
  lng?: number;
  precision_m?: number;
  nota?: string;
  client_uuid?: string;
  cuentaId: string | null;
  dispositivoId?: string;
  foto?: { base64: string };
  /** reloj del dispositivo al enviar; se usa para corregir su desfase */
  enviado_en?: string;
}

/**
 * Hora real de la checada sin confiar en el reloj del teléfono: lo que pasó entre
 * checar y enviar se mide con el mismo reloj, así que su desfase se cancela.
 */
export function horaReal(ocurrido_en: string | undefined, enviado_en: string | undefined, ahora = Date.now()): string | undefined {
  if (!ocurrido_en || !enviado_en) return ocurrido_en;
  const espera = Math.max(0, Date.parse(enviado_en) - Date.parse(ocurrido_en));
  return new Date(ahora - espera).toISOString();
}

/** Guarda la foto de una checada. El tipo se deduce del contenido, no de lo que diga el cliente. */
export async function guardarFoto(c: Cliente, empresaId: string, base64: string): Promise<string> {
  const datos = Buffer.from(base64.replace(/^data:[^,]*,/, ''), 'base64');
  const jpeg = datos[0] === 0xff && datos[1] === 0xd8 && datos[2] === 0xff;
  const webp = datos.subarray(0, 4).toString('latin1') === 'RIFF' && datos.subarray(8, 12).toString('latin1') === 'WEBP';
  if (!jpeg && !webp) throw new HttpError(422, 'La foto no es una imagen válida');
  if (datos.length > 400_000) throw new HttpError(422, 'Foto demasiado grande');
  const { rows: [f] } = await c.query<{ id: string }>(
    'INSERT INTO fotos(empresa_id, mime, datos) VALUES ($1, $2, $3) RETURNING id',
    [empresaId, jpeg ? 'image/jpeg' : 'image/webp', datos]);
  return f.id;
}

/**
 * Inserta una checada. Las reglas (geocerca, secuencia, retardo, periodo
 * cerrado, doble toque) las aplica el trigger de la base; aquí sólo se cuida
 * la idempotencia: reenviar el mismo client_uuid devuelve la checada original.
 */
export async function insertarChecada(c: Cliente, empresaId: string, n: NuevaChecada): Promise<ChecadaRegistrada> {
  if (n.client_uuid) {
    const { rows: [dup] } = await c.query(
      `SELECT ch.id, ch.trabajador_id, t.nombre AS trabajador, ch.tipo, ch.ocurrido_en, ch.incidencias, ch.distancia_m
         FROM checadas ch JOIN trabajadores t ON t.id = ch.trabajador_id WHERE ch.client_uuid = $1`, [n.client_uuid]);
    if (dup) {
      if (dup.trabajador_id !== n.trabajadorId) throw new HttpError(409, 'Identificador de checada repetido');
      const { trabajador_id: _, ...resto } = dup;
      return { ...resto, duplicado: true };
    }
  }
  const fotoId = n.foto ? await guardarFoto(c, empresaId, n.foto.base64) : null;
  const { rows: [ch] } = await c.query(
    `WITH ins AS (
       INSERT INTO checadas(empresa_id, trabajador_id, tipo, medio, modalidad, ocurrido_en, centro_id, lat, lng,
                            precision_m, nota, client_uuid, cuenta_id, dispositivo_id, foto_id)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id, trabajador_id, tipo, ocurrido_en, incidencias, distancia_m)
     SELECT ins.id, t.nombre AS trabajador, ins.tipo, ins.ocurrido_en, ins.incidencias, ins.distancia_m
       FROM ins JOIN trabajadores t ON t.id = ins.trabajador_id`,
    [empresaId, n.trabajadorId, n.tipo, n.medio, n.modalidad, horaReal(n.ocurrido_en, n.enviado_en) ?? null, n.centro_id ?? null,
     n.lat ?? null, n.lng ?? null, n.precision_m ?? null, n.nota ?? null, n.client_uuid ?? null, n.cuentaId,
     n.dispositivoId ?? null, fotoId]);
  return { ...ch, duplicado: false };
}

/** Lo que toca checar ahora según la última checada (misma regla que la base). */
export async function siguientes(c: Cliente, trabajadorId: string, cuando?: string): Promise<TipoChecada[]> {
  const { rows: [r] } = await c.query<{ s: TipoChecada[] }>(
    'SELECT siguientes(ultima_checada($1, COALESCE($2::timestamptz, now())))::text[] AS s', [trabajadorId, cuando ?? null]);
  return r.s;
}

export async function fechaLocal(c: Cliente): Promise<string> {
  const { rows: [r] } = await c.query<{ f: string }>('SELECT (now() AT TIME ZONE zona_horaria)::date AS f FROM empresas');
  return r.f;
}

const COLUMNAS_CHECADA = `c.id, c.tipo, c.ocurrido_en, c.medio, c.modalidad::text, ct.nombre AS centro, c.incidencias, c.distancia_m,
  c.nota, EXISTS (SELECT 1 FROM checadas_anuladas a WHERE a.checada_id = c.id) AS anulada, c.recibido_en, c.foto_id`;

export async function bitacora(c: Cliente, filtro: { trabajadorId?: string; fecha: string }): Promise<(ChecadaVista & {
  trabajador_id: string; trabajador: string; numero: string })[]> {
  const { rows } = await c.query(
    `SELECT ${COLUMNAS_CHECADA}, t.id AS trabajador_id, t.nombre AS trabajador, t.numero
       FROM checadas c JOIN trabajadores t ON t.id = c.trabajador_id LEFT JOIN centros ct ON ct.id = c.centro_id
      WHERE c.fecha = $1 AND ($2::uuid IS NULL OR c.trabajador_id = $2)
      ORDER BY t.numero, c.ocurrido_en`, [filtro.fecha, filtro.trabajadorId ?? null]);
  return rows;
}

/**
 * Minutos trabajados del día: tramos cerrados + el tramo en curso si sigue
 * trabajando (sólo cuando se consulta el día de hoy).
 */
const MINUTOS_DIA = `
  COALESCE((SELECT sum(v.minutos) FROM v_tramos v WHERE v.trabajador_id = t.id AND v.fecha = $1::date), 0)
  + CASE WHEN $2 AND u.tipo IN ('ENTRADA', 'FIN_DESCANSO')
         THEN LEAST(extract(epoch FROM now() - u.ocurrido_en) / 60, 960)::int ELSE 0 END`;

export async function armarTablero(c: Cliente, fecha?: string): Promise<Tablero> {
  const { rows: [e] } = await c.query<{ id: string; clave: string; nombre: string; fecha: string; es_hoy: boolean;
                                        tolerancia_min: number }>(
    `SELECT id, clave, nombre, tolerancia_min, COALESCE($1::date, (now() AT TIME ZONE zona_horaria)::date) AS fecha,
            COALESCE($1::date, (now() AT TIME ZONE zona_horaria)::date) = (now() AT TIME ZONE zona_horaria)::date AS es_hoy
       FROM empresas`, [fecha ?? null]);
  const { rows: equipo } = await c.query(
    `SELECT t.id AS trabajador_id, t.numero, t.nombre, t.puesto, ct.nombre AS centro,
            CASE u.tipo WHEN 'ENTRADA' THEN 'TRABAJANDO' WHEN 'FIN_DESCANSO' THEN 'TRABAJANDO'
                        WHEN 'INICIO_DESCANSO' THEN 'EN_DESCANSO' WHEN 'SALIDA' THEN 'SALIO'
                        ELSE 'SIN_REGISTRO' END AS estado,
            u.ocurrido_en AS ultima_checada, u.modalidad::text AS modalidad,
            (${MINUTOS_DIA}) AS minutos_hoy,
            COALESCE((SELECT array_agg(DISTINCT i ORDER BY i) FROM v_checadas x, unnest(x.incidencias) i
                       WHERE x.trabajador_id = t.id AND x.fecha = $1::date), '{}')
            || CASE WHEN $2 AND u.tipo IS NULL AND t.hora_entrada IS NOT NULL
                         AND (now() AT TIME ZONE e.zona_horaria)::time > t.hora_entrada + make_interval(mins => e.tolerancia_min)
                    THEN ARRAY['NO_HA_LLEGADO'] ELSE '{}'::text[] END AS alertas
       FROM trabajadores t
       JOIN empresas e ON e.id = t.empresa_id
       LEFT JOIN LATERAL (SELECT c.tipo, c.ocurrido_en, c.modalidad, c.centro_id FROM v_checadas c
                           WHERE c.trabajador_id = t.id AND c.fecha = $1::date
                           ORDER BY c.ocurrido_en DESC LIMIT 1) u ON true
       LEFT JOIN centros ct ON ct.id = COALESCE(u.centro_id, t.centro_id)
      WHERE t.activo
      ORDER BY t.numero`, [e.fecha, e.es_hoy]);
  const { rows: incidencias } = await c.query(
    `SELECT c.id AS checada_id, t.nombre AS trabajador, c.tipo, c.ocurrido_en, c.incidencias, c.distancia_m
       FROM v_checadas c JOIN trabajadores t ON t.id = c.trabajador_id
      WHERE c.fecha = $1::date AND cardinality(c.incidencias) > 0
      ORDER BY c.ocurrido_en DESC`, [e.fecha]);
  const { rows: casas } = await c.query(
    `SELECT id AS trabajador_id, nombre FROM trabajadores WHERE activo AND casa_estado = 'PROPUESTA' ORDER BY casa_actualizada_en`);
  const cuenta = (estado: string) => equipo.filter((t) => t.estado === estado).length;
  return {
    empresa: { id: e.id, clave: e.clave, nombre: e.nombre },
    fecha: e.fecha,
    es_hoy: e.es_hoy,
    resumen: {
      trabajando: cuenta('TRABAJANDO'),
      en_descanso: cuenta('EN_DESCANSO'),
      salieron: cuenta('SALIO'),
      sin_registro: cuenta('SIN_REGISTRO'),
      requieren_atencion: equipo.filter((t) => t.alertas.length > 0).length,
      total: equipo.length,
    },
    casas_por_aprobar: casas,
    equipo,
    incidencias,
  };
}
