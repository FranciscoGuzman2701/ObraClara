import { Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Post } from '@nestjs/common';
import { CambiarEmpresaInput, DevLoginInput, EmpresaAcceso, SesionUsuario } from '@obraclara/contracts';
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
        // un mismo correo puede tener usuario en varias empresas: entra a la primera por clave
        `SELECT u.id, u.nombre, u.email, u.empresa_id FROM oc.usuarios u JOIN oc.empresas e ON e.id = u.empresa_id
          WHERE lower(u.email) = lower($1) AND u.activo
          ORDER BY e.clave NULLS LAST, e.nombre, u.id LIMIT 1`,
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

  /**
   * Empresas a las que la persona puede entrar: las que tienen un usuario activo
   * con el mismo correo que la sesión actual. Cada una conserva sus propios roles.
   */
  @Get('empresas')
  empresas(@Sesion() s: Tenant): Promise<EmpresaAcceso[]> {
    return this.db.sistema(async (c) => {
      const { rows } = await c.query<EmpresaAcceso>(
        `SELECT e.id, e.clave, e.nombre, e.id = $2 AS actual
           FROM oc.usuarios yo
           JOIN oc.usuarios u ON lower(u.email) = lower(yo.email) AND u.activo
           JOIN oc.empresas e ON e.id = u.empresa_id
          WHERE yo.id = $1 AND yo.empresa_id = $2 AND yo.activo
          ORDER BY e.clave NULLS LAST, e.nombre`, [s.usuarioId, s.empresaId]);
      return rows;
    });
  }

  /** Emite un token para otra empresa de la misma persona (sin volver a iniciar sesión). */
  @Post('cambiar-empresa')
  cambiarEmpresa(
    @Sesion() s: Tenant,
    @Body(new ZodPipe(CambiarEmpresaInput)) body: CambiarEmpresaInput,
  ): Promise<SesionUsuario> {
    return this.db.sistema(async (c) => {
      const { rows: [usuario] } = await c.query(
        `SELECT u.id, u.nombre, u.email, u.empresa_id
           FROM oc.usuarios yo
           JOIN oc.usuarios u ON lower(u.email) = lower(yo.email) AND u.activo
          WHERE yo.id = $1 AND yo.empresa_id = $2 AND yo.activo AND u.empresa_id = $3`,
        [s.usuarioId, s.empresaId, body.empresa_id]);
      if (!usuario) throw new ForbiddenException('No tiene acceso a esa empresa');
      const token = await firmar({ sub: usuario.id, emp: usuario.empresa_id }, this.config.jwtSecret);
      return { token, usuario };
    });
  }
}
