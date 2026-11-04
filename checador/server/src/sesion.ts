import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import type { Cliente, Contexto, Db } from './db.js';
import { HttpError, prohibido } from './errores.js';
import type { Rol } from './tipos.js';

const EMISOR = 'checador';
const NIVEL: Record<Rol, number> = { TRABAJADOR: 0, SUPERVISOR: 1, RH: 2, ADMIN: 3 };

/** Permisos por rol: ADMIN ⊇ RH ⊇ SUPERVISOR. El TRABAJADOR sólo ve lo suyo. */
export const PERMISO = {
  verEquipo: (r: Rol) => NIVEL[r] >= NIVEL.SUPERVISOR,
  gestionar: (r: Rol) => NIVEL[r] >= NIVEL.RH,
  administrar: (r: Rol) => r === 'ADMIN',
};
export type Permiso = keyof typeof PERMISO;

export interface Miembro extends Contexto {
  cuentaId: string;
  rol: Rol;
  trabajadorId: string | null;
}

export interface Kiosco extends Contexto {
  cuentaId: null;
  dispositivoId: string;
  centroId: string;
  centro: string;
  empresa: string;
  clave: string;
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export class Sesiones {
  private readonly clave: Uint8Array;
  constructor(secreto: string, private readonly db: Db) {
    this.clave = new TextEncoder().encode(secreto);
  }

  firmar(cuentaId: string, empresaId: string): Promise<string> {
    return new SignJWT({ emp: empresaId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(cuentaId).setIssuer(EMISOR).setIssuedAt().setExpirationTime('12h')
      .sign(this.clave);
  }

  async leer(req: FastifyRequest): Promise<{ cuentaId: string; empresaId: string }> {
    const [tipo, token] = (req.headers.authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) throw new HttpError(401, 'Inicie sesión');
    try {
      const { payload } = await jwtVerify(token, this.clave, { issuer: EMISOR });
      if (typeof payload.sub !== 'string' || typeof payload.emp !== 'string') throw new Error('token incompleto');
      return { cuentaId: payload.sub, empresaId: payload.emp };
    } catch {
      throw new HttpError(401, 'La sesión venció; vuelva a entrar');
    }
  }

  /**
   * Abre la transacción de la empresa del token y comprueba que la cuenta siga
   * teniendo acceso (la membresía se puede desactivar en cualquier momento).
   */
  async conMiembro<T>(req: FastifyRequest, permiso: Permiso | null, fn: (c: Cliente, m: Miembro) => Promise<T>): Promise<T> {
    const s = await this.leer(req);
    return this.db.empresa(s, async (c) => {
      const { rows: [r] } = await c.query<{ rol: Rol; trabajador_id: string | null }>(
        'SELECT rol, trabajador_id FROM membresias WHERE cuenta_id = $1 AND activa', [s.cuentaId]);
      if (!r) throw new HttpError(401, 'Ya no tiene acceso a esta empresa');
      if (permiso && !PERMISO[permiso](r.rol)) throw prohibido();
      return fn(c, { ...s, rol: r.rol, trabajadorId: r.trabajador_id });
    });
  }

  /** Tableta de kiosco: se identifica con su propio token (header X-Kiosco), no con una cuenta. */
  async conKiosco<T>(req: FastifyRequest, fn: (c: Cliente, k: Kiosco) => Promise<T>): Promise<T> {
    const token = req.headers['x-kiosco'];
    if (typeof token !== 'string' || token.length < 8) throw new HttpError(401, 'Este dispositivo no está activado como kiosco');
    const k = await this.db.sistema(async (c) => {
      const { rows: [d] } = await c.query(
        `UPDATE dispositivos d SET ultimo_uso = now()
           FROM centros ct, empresas e
          WHERE d.token_hash = $1 AND d.revocado_en IS NULL AND ct.id = d.centro_id AND e.id = d.empresa_id
          RETURNING d.id, d.empresa_id, d.centro_id, ct.nombre AS centro, e.nombre AS empresa, e.clave`, [sha256(token)]);
      return d;
    });
    if (!k) throw new HttpError(401, 'Kiosco desactivado; pida a RH que lo active de nuevo');
    const kiosco: Kiosco = {
      empresaId: k.empresa_id, cuentaId: null, dispositivoId: k.id, centroId: k.centro_id,
      centro: k.centro, empresa: k.empresa, clave: k.clave,
    };
    return this.db.empresa(kiosco, (c) => fn(c, kiosco));
  }
}

/** Freno simple contra adivinar contraseñas: N intentos por clave cada ventana. */
export class Freno {
  private readonly intentos = new Map<string, { n: number; hasta: number }>();
  constructor(private readonly max: number, private readonly ventanaMs: number) {}
  revisar(clave: string) {
    const ahora = Date.now();
    const r = this.intentos.get(clave);
    if (r && r.hasta > ahora && r.n >= this.max) throw new HttpError(429, 'Demasiados intentos; espere unos minutos');
  }
  fallo(clave: string) {
    const ahora = Date.now();
    const r = this.intentos.get(clave);
    if (!r || r.hasta <= ahora) this.intentos.set(clave, { n: 1, hasta: ahora + this.ventanaMs });
    else r.n++;
  }
  exito(clave: string) {
    this.intentos.delete(clave);
  }
}
