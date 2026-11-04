import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import pg from 'pg';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, mensaje: string) {
    super(mensaje);
  }
}
export const prohibido = (m = 'No tiene permiso para esta acción') => new HttpError(403, m);
export const noEncontrado = (m = 'No encontrado') => new HttpError(404, m);
export const invalido = (m: string) => new HttpError(422, m);

/** Mensajes para las restricciones con nombre del esquema. */
const RESTRICCIONES: Record<string, string> = {
  checada_supervisor_con_motivo: 'La corrección necesita un motivo',
  objecion_con_comentario: 'Explique qué no coincide',
  trabajadores_empresa_id_numero_key: 'Ya existe un trabajador con ese número',
  centros_empresa_id_clave_key: 'Ya existe un centro con esa clave',
  periodos_empresa_id_inicio_key: 'Ya existe un periodo que empieza ese día',
  membresias_pkey: 'Esa persona ya tiene acceso a la empresa',
  membresias_trabajador_id_key: 'Ese trabajador ya tiene una cuenta ligada',
  trabajador_con_ficha: 'Para el rol de trabajador, ligue la cuenta a su ficha',
  ux_cuentas_email: 'Ya existe una cuenta con ese correo',
};

export function traducir(err: unknown): { status: number; mensaje: string; campos?: { campo: string; mensaje: string }[] } {
  if (err instanceof HttpError) return { status: err.status, mensaje: err.message };
  if (err instanceof ZodError) {
    return {
      status: 400,
      mensaje: 'Datos inválidos',
      campos: err.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })),
    };
  }
  if (err instanceof pg.DatabaseError) {
    const r = err.constraint ? RESTRICCIONES[err.constraint] : undefined;
    switch (err.code) {
      case 'P0001': return { status: 422, mensaje: err.message };          // RAISE de una regla
      case '23505': return { status: 409, mensaje: r ?? 'Registro duplicado' };
      case '23514': return { status: 422, mensaje: r ?? 'Dato fuera de las reglas' };
      case '23503': return { status: 422, mensaje: 'Referencia inválida (no existe o es de otra empresa)' };
      case '42501': return { status: 403, mensaje: 'Sin permiso sobre este registro' };
      case '22P02': case '22007': case '22008': return { status: 400, mensaje: 'Dato con formato inválido' };
    }
  }
  const fe = err as FastifyError;
  if (fe?.statusCode && fe.statusCode < 500) return { status: fe.statusCode, mensaje: fe.message };
  return { status: 500, mensaje: 'Error interno' };
}

export function manejador(err: unknown, req: FastifyRequest, reply: FastifyReply) {
  const t = traducir(err);
  if (t.status >= 500) req.log.error(err);
  return reply.status(t.status).send({ mensaje: t.mensaje, ...(t.campos ? { campos: t.campos } : {}) });
}

/** Texto corto para reportar el rechazo de un elemento de un lote. */
export const motivoDe = (err: unknown) => traducir(err).mensaje;
