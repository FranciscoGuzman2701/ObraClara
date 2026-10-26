import Link from 'next/link';
import type { Semaforo } from '@obraclara/contracts';
import { api } from '@/lib/api';
import { dinero, numero, pct } from '@/lib/formato';
import { Barra } from '../../../../Barra';
import { Accion, Excepcion } from './Acciones';

interface Linea {
  id: string; concepto_clave: string; insumo: string; unidad: string; cantidad: number; precio_estimado: number;
  semaforo: Semaforo | null; justificacion: string | null; autoriza_excepcion_por: string | null;
  validacion: { motivos: string[]; pct_consumo_cantidad: number; pct_avance_fisico: number; importe_disponible: number } | null;
}
interface Requisicion { id: string; obra_id: string; folio: string; estado: string; lineas: Linea[] }

export default async function DetalleRequisicion({ params }: { params: Promise<{ id: string; reqId: string }> }) {
  const { id, reqId } = await params;
  const [yo, req] = await Promise.all([
    api<{ nombre: string }>('/v1/auth/yo'),
    api<Requisicion>(`/v1/requisiciones/${reqId}`),
  ]);
  return (
    <>
      <Barra usuario={yo.nombre} />
      <main>
        <p className="sub"><Link href={`/obras/${id}`}>← Obra</Link></p>
        <h1>{req.folio}</h1>
        <p className="sub">Estado: <strong>{req.estado}</strong></p>
        <div className="tabla-wrap">
          <table>
            <thead>
              <tr><th>Concepto</th><th>Insumo</th><th className="n">Cantidad</th><th className="n">Precio</th><th className="n">Importe</th><th>Semáforo</th><th>Análisis</th><th /></tr>
            </thead>
            <tbody>
              {req.lineas.map((l) => (
                <tr key={l.id}>
                  <td>{l.concepto_clave}</td>
                  <td>{l.insumo}</td>
                  <td className="n">{numero(l.cantidad)} {l.unidad}</td>
                  <td className="n">{dinero(l.precio_estimado)}</td>
                  <td className="n">{dinero(l.cantidad * l.precio_estimado)}</td>
                  <td>{l.semaforo ? <span className={`chip ${l.semaforo}`}>{l.semaforo}</span> : 'Sin validar'}</td>
                  <td style={{ whiteSpace: 'normal', minWidth: 260 }}>
                    {l.validacion && (
                      <>
                        Consumo proyectado {pct(l.validacion.pct_consumo_cantidad)} · avance físico {pct(l.validacion.pct_avance_fisico)}
                        <ul className="motivos">{l.validacion.motivos.map((m) => <li key={m}>{m}</li>)}</ul>
                      </>
                    )}
                    {l.justificacion && <p className="motivos">Justificación: {l.justificacion}</p>}
                  </td>
                  <td>
                    {req.estado === 'ENVIADA' && l.semaforo === 'AMARILLO' && !l.autoriza_excepcion_por && (
                      <Excepcion id={req.id} obraId={id} lineaId={l.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {req.estado === 'BORRADOR' && <Accion id={req.id} obraId={id} accion="enviar" texto="Enviar a aprobación" primario />}
          {req.estado === 'ENVIADA' && <Accion id={req.id} obraId={id} accion="aprobar" texto="Aprobar" primario />}
          {req.estado === 'ENVIADA' && <Accion id={req.id} obraId={id} accion="devolver" texto="Devolver a borrador" />}
        </p>
        {req.lineas.some((l) => l.semaforo === 'ROJO') && (
          <p className="error">Hay líneas en ROJO: requieren una orden de cambio (traspaso o aditiva) autorizada por Dirección antes de aprobar.</p>
        )}
      </main>
    </>
  );
}
