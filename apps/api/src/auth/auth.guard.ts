import {
  CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable, SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { CONFIG, Config } from '../config';
import type { Tenant } from '../db/db.service';
import { verificar } from './jwt';

const PUBLICO = 'obraclara:publico';
/** Marca un endpoint como accesible sin token. */
export const Publico = () => SetMetadata(PUBLICO, true);

type RequestConSesion = Request & { sesion?: Tenant };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Inject(CONFIG) private readonly config: Config) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLICO, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<RequestConSesion>();
    const [tipo, token] = (req.headers.authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) throw new UnauthorizedException('Falta token');
    try {
      const c = await verificar(token, this.config.jwtSecret);
      req.sesion = { usuarioId: c.sub, empresaId: c.emp };
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido o vencido');
    }
  }
}

/** Inyecta la sesión (usuario + empresa) del request autenticado. */
export const Sesion = createParamDecorator((_: unknown, ctx: ExecutionContext): Tenant => {
  const req = ctx.switchToHttp().getRequest<RequestConSesion>();
  if (!req.sesion) throw new UnauthorizedException();
  return req.sesion;
});
