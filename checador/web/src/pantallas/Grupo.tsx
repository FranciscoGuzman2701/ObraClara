import type { ResumenEmpresa } from '../../../server/src/tipos';
import { api, cambiarEmpresa, mensajeDe } from '../api';
import { ir } from '../ruta';
import { ROL, useSesion } from '../sesion';
import { Cargando, useCarga } from '../ui';

/** Las empresas del grupo lado a lado. Cada una lleva su propio registro; aquí sólo se ven juntas. */
export function Grupo() {
  const { actualizar } = useSesion();
  const { datos, error } = useCarga(() => api<{ empresas: ResumenEmpresa[] }>('/api/grupo'), [], 60_000);
  if (!datos) return <Cargando error={error} />;
  const e = datos.empresas;
  const suma = (k: 'trabajando' | 'en_descanso' | 'sin_registro' | 'requieren_atencion' | 'total') => e.reduce((s, x) => s + x[k], 0);
  const entrar = async (id: string) => {
    try { actualizar(await cambiarEmpresa(id)); ir('/equipo'); } catch (err) { alert(mensajeDe(err)); }
  };
  return (
    <>
      <div className="encabezado"><div><h1>Grupo</h1><p className="tenue"><span className="vivo">Hoy, en vivo</span> · {e.length} empresas</p></div></div>
      <div className="tarjetas">
        <div className="tarjeta"><div className="et">Personas</div><div className="val">{suma('total')}</div></div>
        <div className="tarjeta ok"><div className="et">Trabajando</div><div className="val">{suma('trabajando')}</div></div>
        <div className="tarjeta"><div className="et">En descanso</div><div className="val">{suma('en_descanso')}</div></div>
        <div className="tarjeta"><div className="et">Sin registro</div><div className="val">{suma('sin_registro')}</div></div>
        <div className={`tarjeta${suma('requieren_atencion') ? ' atencion' : ''}`}><div className="et">Requieren atención</div><div className="val">{suma('requieren_atencion')}</div></div>
      </div>
      <h2>Por empresa</h2>
      <div className="caja"><div className="tabla-wrap"><table>
        <thead><tr><th>Empresa</th><th className="n">Personas</th><th className="n">Trabajando</th><th className="n">Descanso</th>
          <th className="n ocultar-movil">Salieron</th><th className="n">Sin registro</th><th className="n">Atención</th><th /></tr></thead>
        <tbody>
          {e.map((x) => (
            <tr key={x.id} className="clic" onClick={() => void entrar(x.id)}>
              <td><strong>{x.clave}</strong> <span className="tenue">{x.nombre !== x.clave ? x.nombre : ''}</span>
                <small className="tenue" style={{ display: 'block' }}>{ROL[x.rol]}</small></td>
              <td className="n">{x.total}</td><td className="n verde">{x.trabajando}</td><td className="n">{x.en_descanso}</td>
              <td className="n ocultar-movil">{x.salieron}</td><td className="n">{x.sin_registro}</td>
              <td className={`n${x.requieren_atencion ? ' rojo' : ''}`}><strong>{x.requieren_atencion}</strong></td>
              <td><span className="boton chico">Entrar →</span></td>
            </tr>
          ))}
        </tbody>
      </table></div></div>
    </>
  );
}
