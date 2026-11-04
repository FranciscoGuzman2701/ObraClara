import Link from 'next/link';
import type { PeriodoTrabajador } from '@obraclara/contracts';
import { api } from '@/lib/api';
import { numero } from '@/lib/formato';
import { Barra } from '../../../Barra';

export default async function DetallePeriodo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [yo, filas] = await Promise.all([
    api<{ nombre: string }>('/v1/auth/yo'),
    api<PeriodoTrabajador[]>(`/v1/checador/periodos/${id}`),
  ]);
  return (
    <>
      <Barra usuario={yo.nombre} />
      <main>
        <h1>Cierre del periodo</h1>
        <p className="sub"><Link href="/checador/periodos">Todos los periodos</Link></p>
        <div className="tabla-wrap">
          <table>
            <thead><tr><th>No.</th><th>Trabajador</th><th className="n">Horas</th><th className="n">Días</th><th className="n">Incidencias</th><th className="n">Correcciones</th><th className="n">Sin salida</th><th>Respuesta</th></tr></thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.trabajador_id}>
                  <td>{f.numero}</td>
                  <td>{f.nombre}</td>
                  <td className="n">{numero(f.horas)}</td>
                  <td className="n">{f.dias_trabajados}</td>
                  <td className={`n${f.incidencias ? ' neg' : ''}`}>{f.incidencias}</td>
                  <td className="n">{f.correcciones}</td>
                  <td className={`n${f.jornadas_abiertas ? ' neg' : ''}`}>{f.jornadas_abiertas}</td>
                  <td>
                    {f.respuesta
                      ? <><span className={`chip ${f.respuesta}`}>{f.respuesta === 'ACEPTADO' ? 'Aceptó' : 'Objetó'}</span>
                          {f.comentario && <div className="motivos">{f.comentario}</div>}</>
                      : <span className="sub">Pendiente</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
