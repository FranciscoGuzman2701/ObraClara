import { Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Post } from '@nestjs/common';
import { DevLoginInput, SesionUsuario } from '@obraclara/contracts';
import { CONFIG, Config } from '../config';
import { DbService, Tenant } from '../db/db.service';
import { ZodPipe } from '../common/zod.pipe';
import { Publico, Sesion } from './auth.guard';
import { firmar } from './jwt';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly db: DbService, @Inject(CONFIG) private readonly config: Config) {}

  /**
   * Login de desarrollo por correo, sin contraseña. Deshabilitado en producción;
   * ahí se sustituye por OTP telefónico / proveedor de identidad.
   */
  @Publico()
  @Post('dev-login')
  async devLogin(@Body(new ZodPipe(DevLoginInput)) body: DevLoginInput): Promise<SesionUsuario> {
    if (!this.config.allowDevLogin) throw new ForbiddenException('Login de desarrollo deshabilitado');
    const usuario = await this.db.sistema(async (c) => {
      const { rows } = await c.query(
        'SELECT id, nombre, email, empresa_id FROM oc.usuarios WHERE lower(email) = lower($1) AND activo',
        [body.email],
      );
      return rows[0];
    });
    if (!usuario) throw new NotFoundException('Usuario no encontrado');
    const token = await firmar({ sub: usuario.id, emp: usuario.empresa_id }, this.config.jwtSecret);
    return { token, usuario };
  }

  @Get('yo')
  async yo(@Sesion() s: Tenant) {
    return this.db.tenant(s, async (c) => {
      const { rows } = await c.query('SELECT id, nombre, email, empresa_id FROM usuarios WHERE id = $1', [s.usuarioId]);
      return rows[0];
    });
  }
}
