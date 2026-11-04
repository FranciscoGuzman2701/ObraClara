'use server';
// Server Actions: login/logout y transiciones de requisiciones.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { SesionUsuario } from '@obraclara/contracts';
import { API_URL, COOKIE, api, ApiError } from '@/lib/api';

export async function iniciarSesion(_: string | null, form: FormData): Promise<string | null> {
  const email = String(form.get('email') ?? '');
  const res = await fetch(`${API_URL}/v1/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  }).catch(() => null);
  if (!res) return 'No se pudo conectar con el API';
  if (!res.ok) return res.status === 404 ? 'Usuario no encontrado' : 'No se pudo iniciar sesión';
  const sesion = (await res.json()) as SesionUsuario;
  await guardarToken(sesion.token);
  redirect('/');
}

function guardarToken(token: string) {
  return cookies().then((c) => c.set(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 12 * 3600,
  }));
}

/** Cambia a otra empresa de la misma persona: el API emite un token nuevo con esa empresa. */
export async function cambiarEmpresa(form: FormData) {
  const sesion = await api<SesionUsuario>('/v1/auth/cambiar-empresa', {
    method: 'POST', body: JSON.stringify({ empresa_id: String(form.get('empresa_id')) }),
  });
  await guardarToken(sesion.token);
  revalidatePath('/', 'layout');
  redirect('/');
}

export async function cerrarSesion() {
  (await cookies()).delete(COOKIE);
  redirect('/login');
}

export type EstadoAccion = { error?: string; ok?: string } | null;

export async function accionRequisicion(_: EstadoAccion, form: FormData): Promise<EstadoAccion> {
  const id = String(form.get('id'));
  const obraId = String(form.get('obra_id'));
  const accion = String(form.get('accion'));
  if (!['enviar', 'aprobar', 'devolver', 'excepciones'].includes(accion)) return { error: 'Acción inválida' };
  const body = accion === 'excepciones'
    ? { requisicion_linea_id: String(form.get('linea_id')), justificacion: String(form.get('justificacion') ?? '') }
    : undefined;
  try {
    await api(`/v1/requisiciones/${id}/${accion}`, { method: 'POST', body: body && JSON.stringify(body) });
  } catch (e) {
    return { error: e instanceof ApiError ? e.message : 'Error inesperado' };
  }
  revalidatePath(`/obras/${obraId}`);
  revalidatePath(`/obras/${obraId}/requisiciones/${id}`);
  return { ok: 'Listo' };
}

// ----------------------------------------------------------------- checador
export async function accionPeriodo(_: EstadoAccion, form: FormData): Promise<EstadoAccion> {
  const accion = String(form.get('accion'));
  try {
    if (accion === 'crear') {
      await api('/v1/checador/periodos', {
        method: 'POST',
        body: JSON.stringify({
          nombre: String(form.get('nombre') ?? ''), inicio: String(form.get('inicio') ?? ''), fin: String(form.get('fin') ?? ''),
        }),
      });
    } else if (accion === 'cerrar') {
      await api(`/v1/checador/periodos/${String(form.get('id'))}/cerrar`, { method: 'POST' });
    } else {
      return { error: 'Acción inválida' };
    }
  } catch (e) {
    return { error: e instanceof ApiError ? e.message : 'Error inesperado' };
  }
  revalidatePath('/checador/periodos');
  return { ok: accion === 'crear' ? 'Periodo creado' : 'Periodo cerrado' };
}
