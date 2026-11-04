import { ForbiddenException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { Rol } from '@obraclara/contracts';

/** Roles efectivos de un usuario en una obra: los de la obra + los de alcance empresa. */
export async function rolesEnObra(c: PoolClient, usuarioId: string, obraId: string): Promise<Rol[]> {
  const { rows } = await c.query<{ rol: Rol }>(
    `SELECT rol FROM obra_miembros WHERE usuario_id = $1 AND obra_id = $2
     UNION
     SELECT er.rol FROM empresa_roles er JOIN obras o ON o.empresa_id = er.empresa_id
      WHERE er.usuario_id = $1 AND o.id = $2`,
    [usuarioId, obraId],
  );
  return rows.map((r) => r.rol);
}

/** Lanza 403 si el usuario no tiene ninguno de los roles en la obra (DIRECTOR y ADMIN siempre pasan). */
export async function exigirRol(c: PoolClient, usuarioId: string, obraId: string, permitidos: Rol[]): Promise<Rol[]> {
  const roles = await rolesEnObra(c, usuarioId, obraId);
  const ok = roles.some((r) => r === 'DIRECTOR' || r === 'ADMIN' || permitidos.includes(r));
  if (!ok) {
    throw new ForbiddenException(`Requiere rol ${permitidos.join(' / ')} en la obra`);
  }
  return roles;
}

/** Roles de alcance empresa del usuario en la empresa de la sesión (RLS ya filtra la empresa). */
export async function rolesEmpresa(c: PoolClient, usuarioId: string): Promise<Rol[]> {
  const { rows } = await c.query<{ rol: Rol }>('SELECT rol FROM empresa_roles WHERE usuario_id = $1', [usuarioId]);
  return rows.map((r) => r.rol);
}

/** Lanza 403 si el usuario no tiene alguno de los roles en la empresa (DIRECTOR y ADMIN siempre pasan). */
export async function exigirRolEmpresa(c: PoolClient, usuarioId: string, permitidos: Rol[]): Promise<Rol[]> {
  const roles = await rolesEmpresa(c, usuarioId);
  if (!roles.some((r) => r === 'DIRECTOR' || r === 'ADMIN' || permitidos.includes(r))) {
    throw new ForbiddenException(`Requiere rol ${permitidos.join(' / ')} en la empresa`);
  }
  return roles;
}
