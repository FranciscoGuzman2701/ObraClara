// Cliente del API para Server Components y Server Actions. El token vive en
// una cookie httpOnly; el navegador nunca lo ve.
import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const API_URL = process.env.OBRACLARA_API_URL ?? 'http://localhost:3001';
export const COOKIE = 'oc_token';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) redirect('/login');
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...init.headers },
  });
  if (res.status === 401) redirect('/login');
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.mensaje ?? body.message ?? `Error ${res.status}`);
  return body as T;
}
