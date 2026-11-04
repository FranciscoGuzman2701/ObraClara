import { useCallback, useEffect, useState } from 'react';

function Redirigir({ a }: { a: string }) {
  useEffect(() => { ir(a); }, [a]);
  return null;
}
import type { InfoSesion } from '../../server/src/tipos';
import { api, ApiError, onSesionVencida, token } from './api';
import { ir, useRuta } from './ruta';
import { puede, Sesion } from './sesion';
import { Marco } from './Marco';
import { Login } from './pantallas/Login';
import { Checar } from './pantallas/Checar';
import { MisPeriodos } from './pantallas/MisPeriodos';
import { Kiosco } from './pantallas/Kiosco';
import { Equipo } from './pantallas/Equipo';
import { Trabajadores } from './pantallas/Trabajadores';
import { Centros } from './pantallas/Centros';
import { Kioscos } from './pantallas/Kioscos';
import { Usuarios } from './pantallas/Usuarios';
import { Periodos, PeriodoDetalle } from './pantallas/Periodos';
import { Grupo } from './pantallas/Grupo';
import { Ajustes } from './pantallas/Ajustes';

const CACHE_SESION = 'checador:sesion';

export function App() {
  const ruta = useRuta();
  const [info, setInfo] = useState<InfoSesion | null>(() => {
    // sin señal se usa la última sesión conocida para poder checar
    try { return token.get() ? JSON.parse(localStorage.getItem(CACHE_SESION) ?? 'null') : null; } catch { return null; }
  });
  const [listo, setListo] = useState(false);

  const actualizar = useCallback((i: InfoSesion) => {
    const { token: _t, ...resto } = i;
    setInfo(resto);
    try { localStorage.setItem(CACHE_SESION, JSON.stringify(resto)); } catch { /* */ }
  }, []);
  const salir = useCallback(() => {
    token.set(null);
    try { localStorage.removeItem(CACHE_SESION); } catch { /* */ }
    setInfo(null);
    ir('/');
  }, []);

  useEffect(() => { onSesionVencida(salir); }, [salir]);
  useEffect(() => {
    if (!token.get()) { setListo(true); return; }
    api<InfoSesion>('/api/sesion')
      .then(actualizar)
      .catch((e) => { if (e instanceof ApiError && e.status === 401) salir(); })
      .finally(() => setListo(true));
  }, [actualizar, salir]);

  // el kiosco no usa sesión de persona: la tableta tiene su propio código
  if (ruta.split('/')[1] === 'kiosco') return <Kiosco />;
  if (!info) return listo ? <Login alEntrar={(i) => { actualizar(i); ir('/'); }} /> : null;

  const ctx = { info, actualizar, salir };
  const inicio = puede.verEquipo(info) ? '/equipo' : '/checar';
  const [, seccion, param] = ruta.split('/');

  let pagina;
  if (ruta === '/' || ruta === '') return <Redirigir a={inicio} />;
  if (seccion === 'checar') pagina = <Checar />;
  else if (seccion === 'mis-periodos') pagina = <MisPeriodos />;
  else if (seccion === 'ajustes' && !puede.verEquipo(info)) pagina = <Ajustes movil />;
  else if (!puede.verEquipo(info)) return <Redirigir a="/checar" />;
  else {
    const panel = {
      equipo: <Equipo />, trabajadores: <Trabajadores />, centros: <Centros />, kioscos: <Kioscos />,
      usuarios: <Usuarios />, periodos: param ? <PeriodoDetalle id={param} /> : <Periodos />, grupo: <Grupo />,
      ajustes: <Ajustes />,
    }[seccion];
    pagina = <Marco>{panel ?? <Equipo />}</Marco>;
  }
  return <Sesion.Provider value={ctx}>{pagina}</Sesion.Provider>;
}
