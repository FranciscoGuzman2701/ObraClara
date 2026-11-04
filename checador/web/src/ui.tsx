import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { mensajeDe } from './api';

/** Carga datos y permite recargar; `cadaMs` refresca solo (tablero en vivo). */
export function useCarga<T>(fn: () => Promise<T>, deps: unknown[], cadaMs?: number) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef(fn);
  ref.current = fn;
  const recargar = useCallback(async () => {
    try {
      setDatos(await ref.current());
      setError(null);
    } catch (e) {
      setError(mensajeDe(e));
    }
  }, []);
  useEffect(() => {
    setDatos(null);
    void recargar();
    if (!cadaMs) return;
    const id = setInterval(() => { if (document.visibilityState === 'visible') void recargar(); }, cadaMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { datos, error, recargar };
}

/** Ejecuta una acción mostrando su error; devuelve true si salió bien. */
export function useAccion() {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const correr = useCallback(async (fn: () => Promise<unknown>) => {
    setOcupado(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(mensajeDe(e));
      return false;
    } finally {
      setOcupado(false);
    }
  }, []);
  return { ocupado, error, setError, correr };
}

export function Aviso({ tipo = 'error', children }: { tipo?: 'error' | 'ok' | 'info'; children: ReactNode }) {
  if (!children) return null;
  return <div className={`aviso ${tipo}`} role={tipo === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Campo({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: string; children: ReactNode }) {
  return (
    <label className="campo">
      <span>{etiqueta}</span>
      {children}
      {ayuda && <small>{ayuda}</small>}
    </label>
  );
}

export function Modal({ titulo, alCerrar, children }: { titulo: string; alCerrar: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') alCerrar(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [alCerrar]);
  return (
    <div className="velo" onMouseDown={(e) => { if (e.target === e.currentTarget) alCerrar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-cab"><h3 style={{ margin: 0 }}>{titulo}</h3>
          <button className="cerrar" onClick={alCerrar} aria-label="Cerrar">×</button></div>
        <div className="modal-cuerpo">{children}</div>
      </div>
    </div>
  );
}

export function Chip({ clase, children }: { clase: string; children: ReactNode }) {
  return <span className={`chip ${clase}`}>{children}</span>;
}

export const iniciales = (nombre: string) =>
  nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

export function Persona({ nombre, detalle }: { nombre: string; detalle?: ReactNode }) {
  return (
    <div className="persona">
      <span className="avatar" aria-hidden>{iniciales(nombre)}</span>
      <div><strong>{nombre}</strong>{detalle && <small>{detalle}</small>}</div>
    </div>
  );
}

export function Cargando({ error }: { error?: string | null }) {
  return error ? <Aviso>{error}</Aviso> : <p className="tenue">Cargando…</p>;
}

/** Reloj que se actualiza cada segundo. */
export function useAhora(ms = 1000) {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return ahora;
}
