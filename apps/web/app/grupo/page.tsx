import type { ResumenGrupo } from '@obraclara/contracts';
import { api } from '@/lib/api';
import { Barra } from '../Barra';
import { cambiarEmpresa } from '../acciones';

/** Una fila por empresa: cada una lleva su propio registro; aquí sólo se suma para verlas juntas. */
export default async function Grupo() {
  const [yo, grupo] = await Promise.all([
    api<{ nombre: string }>('/v1/auth/yo'),
    api<ResumenGrupo>('/v1/grupo/asistencia'),
  ]);
  const total = grupo.empresas.reduce(
    (a, e) => ({ trabajando: a.trabajando + e.trabajando, en_descanso: a.en_descanso + e.en_descanso,
                 sin_registro: a.sin_registro + e.sin_registro, requieren_atencion: a.requieren_atencion + e.requieren_atencion }),
    { trabajando: 0, en_descanso: 0, sin_registro: 0, requieren_atencion: 0 },
  );
  return (
    <>
      <Barra usuario={yo.nombre} />
      <main>
        <h1>Asistencia del grupo</h1>
        <p className="sub">Hoy, en vivo · {grupo.empresas.length} empresas</p>
        <div className="tarjetas">
          <div className="tarjeta"><div className="et">Trabajando</div><div className="val">{total.trabajando}</div></div>
          <div className="tarjeta"><div className="et">En descanso</div><div className="val">{total.en_descanso}</div></div>
          <div className="tarjeta"><div className="et">Sin registro</div><div className="val">{total.sin_registro}</div></div>
          <div className={`tarjeta${total.requieren_atencion ? ' atencion' : ''}`}>
            <div className="et">Requieren atención</div><div className="val">{total.requieren_atencion}</div>
          </div>
        </div>
        <h2>Por empresa</h2>
        <div className="tabla-wrap">
          <table>
            <thead><tr><th>Empresa</th><th className="n">Trabajando</th><th className="n">En descanso</th><th className="n">Salieron</th><th className="n">Sin registro</th><th className="n">Requieren atención</th><th /></tr></thead>
            <tbody>
              {grupo.empresas.map((e) => (
                <tr key={e.id}>
                  <td><strong>{e.clave}</strong> {e.nombre !== e.clave && e.nombre}</td>
                  <td className="n">{e.trabajando}</td>
                  <td className="n">{e.en_descanso}</td>
                  <td className="n">{e.salieron}</td>
                  <td className="n">{e.sin_registro}</td>
                  <td className={`n${e.requieren_atencion ? ' neg' : ''}`}>{e.requieren_atencion}</td>
                  <td>
                    <form action={cambiarEmpresa} className="acciones">
                      <input type="hidden" name="empresa_id" value={e.id} />
                      <button>Entrar</button>
                    </form>
                  </td>
                </tr>
              ))}
              {grupo.empresas.length === 0 && <tr><td colSpan={7} className="vacio">No supervisa ninguna empresa</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
