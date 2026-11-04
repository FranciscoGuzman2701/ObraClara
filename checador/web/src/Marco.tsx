import type { ReactNode } from 'react';
import { cambiarEmpresa, mensajeDe } from './api';
import { ir, useRuta } from './ruta';
import { puede, ROL, useSesion } from './sesion';

/** Armazón del panel: barra con navegación por rol y selector de empresa. */
export function Marco({ children }: { children: ReactNode }) {
  const { info, actualizar, salir } = useSesion();
  const ruta = useRuta();
  const enlaces: [string, string, boolean][] = [
    ['/equipo', 'Equipo', true],
    ['/checar', 'Checar', !!info.trabajador],
    ['/periodos', 'Periodos', puede.gestionar(info)],
    ['/trabajadores', 'Trabajadores', true],
    ['/centros', 'Centros', puede.gestionar(info)],
    ['/kioscos', 'Kioscos', puede.gestionar(info)],
    ['/usuarios', 'Usuarios', puede.gestionar(info)],
    ['/grupo', 'Grupo', info.empresas.filter((e) => e.rol !== 'TRABAJADOR').length > 1],
    ['/ajustes', 'Ajustes', true],
  ];
  const cambiar = async (id: string) => {
    try {
      actualizar(await cambiarEmpresa(id));
      ir('/equipo');
    } catch (e) {
      alert(mensajeDe(e));
    }
  };
  return (
    <>
      <header className="barra">
        <div className="barra-in">
          <a className="marca" href="#/equipo"><img src="/icono.svg" alt="" />Checador</a>
          <nav className="nav" aria-label="Secciones">
            {enlaces.filter(([, , ver]) => ver).map(([href, texto]) => (
              <a key={href} href={`#${href}`} className={ruta.startsWith(href) ? 'activo' : undefined}>{texto}</a>
            ))}
          </nav>
          <div className="usuario">
            {info.empresas.length > 1 ? (
              <select className="selector-empresa" aria-label="Empresa" value={info.empresa.id} onChange={(e) => void cambiar(e.target.value)}>
                {info.empresas.map((e) => <option key={e.id} value={e.id}>{e.clave} · {e.nombre}</option>)}
              </select>
            ) : <strong>{info.empresa.clave}</strong>}
            <span className="nombre-usuario" title={ROL[info.rol]}>{info.cuenta.nombre}</span>
            <button className="boton chico" onClick={salir}>Salir</button>
          </div>
        </div>
      </header>
      <main className="contenido">{children}</main>
    </>
  );
}
