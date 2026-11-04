import { createContext, useContext } from 'react';
import type { InfoSesion } from '../../server/src/tipos';

export interface CtxSesion {
  info: InfoSesion;
  actualizar: (i: InfoSesion) => void;
  salir: () => void;
}
export const Sesion = createContext<CtxSesion | null>(null);
export function useSesion() {
  const s = useContext(Sesion);
  if (!s) throw new Error('Sin sesión');
  return s;
}

const NIVEL = { TRABAJADOR: 0, SUPERVISOR: 1, RH: 2, ADMIN: 3 } as const;
export const puede = {
  verEquipo: (i: InfoSesion) => NIVEL[i.rol] >= 1,
  gestionar: (i: InfoSesion) => NIVEL[i.rol] >= 2,
  administrar: (i: InfoSesion) => i.rol === 'ADMIN',
};
export const ROL: Record<InfoSesion['rol'], string> = {
  ADMIN: 'Administrador', RH: 'Recursos humanos', SUPERVISOR: 'Supervisor', TRABAJADOR: 'Trabajador',
};
