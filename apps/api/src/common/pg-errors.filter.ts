import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { DatabaseError } from 'pg';

/**
 * Las reglas de negocio viven también en la base (triggers). Sus RAISE EXCEPTION
 * llegan como errores de pg y aquí se traducen a respuestas HTTP legibles.
 */
@Catch()
export class ErroresFilter implements ExceptionFilter {
  private readonly log = new Logger('Errores');

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof HttpException) {
      const body = err.getResponse();
      res.status(err.getStatus()).json(typeof body === 'string' ? { mensaje: body } : body);
      return;
    }
    if (err instanceof DatabaseError) {
      const { status, mensaje } = traducir(err);
      res.status(status).json({ mensaje, codigo: err.code });
      return;
    }
    this.log.error(err);
    res.status(500).json({ mensaje: 'Error interno' });
  }
}

export function traducir(err: DatabaseError): { status: number; mensaje: string } {
  switch (err.code) {
    case 'P0001': // RAISE EXCEPTION de una regla de negocio
      return { status: 422, mensaje: err.message };
    case '23505':
      return { status: 409, mensaje: 'Registro duplicado' };
    case '23503':
      return { status: 422, mensaje: 'Referencia inválida: el registro relacionado no existe o pertenece a otra obra' };
    case '23514':
      return { status: 422, mensaje: `Regla de integridad violada (${err.constraint ?? 'check'})` };
    case '42501':
      return { status: 403, mensaje: 'Sin permiso sobre este registro' };
    case '22P02':
      return { status: 400, mensaje: 'Identificador inválido' };
    default:
      return { status: 500, mensaje: 'Error de base de datos' };
  }
}
