import Link from 'next/link';
import type { PeriodoResumen } from '@obraclara/contracts';
import { api, ApiError } from '@/lib/api';
import { Barra } from '../../Barra';
import { CerrarPeriodo, NuevoPeriodo } from './FormPeriodo';

export default async function Periodos() {
  const yo = await api<{ nombre: string }>('/v1/auth/yo');
  let periodos: PeriodoResumen[] | null = null;
  let error: string | null = null;
  try {
    periodos = await api<PeriodoResumen[]>('/v1/checador/periodos');
  } catch (e) {
    error = e instanceof ApiError ? e.message : 'No se pudo cargar';
  }
  return (
    <>
      <Barra usuario={yo.nombre} />
      <main>
        <h1>Periodos de asistencia</h1>
        <p className="sub">
          Al cerrar, las horas de cada trabajador quedan congeladas y cada quien las acepta u objeta.
          {' '}<Link href="/checador">Volver al tablero</Link>
        </p>
        {error && <p className="error">{error}</p>}
        {periodos && (
          <>
            <NuevoPeriodo />
            <div className="tabla-wrap">
              <table>
                <thead><tr><th>Periodo</th><th>Del</th><th>Al</th><th>Estado</th><th className="n">Trabajadores</th><th className="n">Aceptaron</th><th className="n">Objetaron</th><th /></tr></thead>
                <tbody>
                  {periodos.map((p) => (
                    <tr key={p.id}>
                      <td>{p.estado === 'CERRADO' ? <Link href={`/checador/periodos/${p.id}`}>{p.nombre}</Link> : p.nombre}</td>
                      <td>{p.inicio}</td>
                      <td>{p.fin}</td>
                      <td><span className={`chip ${p.estado}`}>{p.estado === 'CERRADO' ? 'Cerrado' : 'Abierto'}</span></td>
                      <td className="n">{p.trabajadores || '—'}</td>
                      <td className="n">{p.estado === 'CERRADO' ? p.aceptados : '—'}</td>
                      <td className={`n${p.objetados ? ' neg' : ''}`}>{p.estado === 'CERRADO' ? p.objetados : '—'}</td>
                      <td>{p.estado === 'ABIERTO' && <CerrarPeriodo id={p.id} />}</td>
                    </tr>
                  ))}
                  {periodos.length === 0 && <tr><td colSpan={8} className="vacio">Aún no hay periodos</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </>
  );
}
