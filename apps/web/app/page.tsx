import Link from 'next/link';
import type { ObraResumen } from '@obraclara/contracts';
import { api } from '@/lib/api';
import { dinero } from '@/lib/formato';
import { Barra } from './Barra';

export default async function Inicio() {
  const [yo, obras] = await Promise.all([
    api<{ nombre: string }>('/v1/auth/yo'),
    api<ObraResumen[]>('/v1/obras'),
  ]);
  return (
    <>
      <Barra usuario={yo.nombre} />
      <main>
        <h1>Obras</h1>
        <p className="sub">Obras en las que participas</p>
        <div className="tabla-wrap">
          <table>
            <thead>
              <tr><th>Clave</th><th>Obra</th><th>Cliente</th><th className="n">Contrato</th><th>Presupuesto</th><th>Tu rol</th></tr>
            </thead>
            <tbody>
              {obras.map((o) => (
                <tr key={o.id}>
                  <td>{o.clave}</td>
                  <td><Link href={`/obras/${o.id}`}>{o.nombre}</Link></td>
                  <td>{o.cliente ?? '—'}</td>
                  <td className="n">{dinero(o.monto_contrato)}</td>
                  <td>{o.presupuesto_estado === 'AUTORIZADO' ? 'Autorizado' : 'Borrador'}</td>
                  <td>{o.roles.join(', ')}</td>
                </tr>
              ))}
              {obras.length === 0 && <tr><td colSpan={6} className="vacio">Sin obras asignadas</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
