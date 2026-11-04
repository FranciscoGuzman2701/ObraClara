// Rutas por hash (#/equipo, #/periodos/…): funciona en cualquier hosting estático y sin señal.
import { useEffect, useState } from 'react';

const actual = () => window.location.hash.replace(/^#/, '') || '/';

export function useRuta() {
  const [ruta, setRuta] = useState(actual);
  useEffect(() => {
    const f = () => setRuta(actual());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return ruta;
}

export const ir = (ruta: string) => { window.location.hash = ruta; };
