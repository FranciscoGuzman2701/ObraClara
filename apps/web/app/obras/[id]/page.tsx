import Link from 'next/link';
import type { ConceptoPresupuesto, KpiObra, ObraResumen, Semaforo } from '@obraclara/contracts';
import { api, ApiError } from '@/lib/api';
import { dinero, indice, numero, pct } from '@/lib/formato';
import { Barra } from '../../Barra';

interface FilaRequisicion {
  id: string; folio: string; estado: string; solicitante: string; lineas: number;
  importe_estimado: number; peor_semaforo: Semaforo | null; creado_en: string;
}

const suma = (co: ConceptoPresupuesto, campo: keyof ConceptoPresupuesto['lineas'][number]) =>
  co.lineas.reduce((t, l) => t + Number(l[campo] ?? 0), 0);

export default async function Obra({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [yo, obras, presupuesto, requisiciones, kpis] = await Promise.all([
    api<{ nombre: string }>('/v1/auth/yo'),
    api<ObraResumen[]>('/v1/obras'),
    api<ConceptoPresupuesto[]>(`/v1/obras/${id}/presupuesto`),
    api<FilaRequisicion[]>(`/v1/obras/${id}/requisiciones`).catch(() => [] as FilaRequisicion[]),
    // los KPIs sólo existen para roles con acceso a importes
    api<KpiObra>(`/v1/obras/${id}/kpis`).catch((e) => (e instanceof ApiError && e.status === 403 ? null : Promise.reject(e))),
  ]);
  const obra = obras.find((o) => o.id === id);
  const partidas = [...new Map(presupuesto.map((c) => [c.partida_clave, c.partida_descripcion])).entries()];

  return (
    <>
      <Barra usuario={yo.nombre} />
      <main>
        <p className="sub"><Link href="/">Obras</Link> › {obra?.clave}</p>
        <h1>{obra?.nombre}</h1>
        <p className="sub">{obra?.cliente} · contrato {dinero(obra?.monto_contrato)}</p>

        {kpis && (
          <section className="tarjetas" aria-label="Indicadores">
            <Tarjeta et="Avance físico" val={pct(kpis.pct_avance_fisico)} />
            <Tarjeta et="Avance financiero" val={pct(kpis.pct_avance_financiero)} />
            <Tarjeta et="CPI" val={indice(kpis.cpi)} alerta={kpis.cpi != null && kpis.cpi < 0.95} />
            <Tarjeta et="SPI" val={indice(kpis.spi)} alerta={kpis.spi != null && kpis.spi < 0.9} />
            <Tarjeta et="Ejercido" val={dinero(kpis.ac)} />
            <Tarjeta et="Comprometido" val={dinero(kpis.comprometido)} />
            <Tarjeta et="Costo proyectado (EAC)" val={dinero(kpis.eac ?? kpis.bac)} />
            <Tarjeta
              et="Margen proyectado"
              val={dinero(kpis.margen_proyectado ?? (kpis.monto_contrato ?? 0) - kpis.bac)}
              alerta={(kpis.margen_proyectado ?? 0) < 0}
            />
          </section>
        )}

        <h2>Requisiciones</h2>
        <div className="tabla-wrap">
          <table>
            <thead>
              <tr><th>Folio</th><th>Estado</th><th>Semáforo</th><th>Solicitó</th><th className="n">Líneas</th><th className="n">Importe estimado</th></tr>
            </thead>
            <tbody>
              {requisiciones.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/obras/${id}/requisiciones/${r.id}`}>{r.folio}</Link></td>
                  <td>{r.estado}</td>
                  <td>{r.peor_semaforo ? <span className={`chip ${r.peor_semaforo}`}>{r.peor_semaforo}</span> : '—'}</td>
                  <td>{r.solicitante}</td>
                  <td className="n">{r.lineas}</td>
                  <td className="n">{dinero(r.importe_estimado)}</td>
                </tr>
              ))}
              {requisiciones.length === 0 && <tr><td colSpan={6} className="vacio">Sin requisiciones</td></tr>}
            </tbody>
          </table>
        </div>

        <h2>Presupuesto vs. ejecutado vs. pagado</h2>
        <div className="leyenda">
          <span><i style={{ background: 'var(--fisico)' }} />Avance físico</span>
          <span><i style={{ background: 'var(--financiero)' }} />Avance financiero (ejercido)</span>
        </div>
        <div className="tabla-wrap">
          <table>
            <thead>
              <tr>
                <th>Clave</th><th>Concepto / insumo</th><th>Ud</th><th className="n">Cantidad</th>
                <th className="n">Vigente</th><th className="n">Reservado</th><th className="n">Comprometido</th>
                <th className="n">Ejercido</th><th className="n">Pagado</th><th className="n">Disponible</th><th>Físico / financiero</th>
              </tr>
            </thead>
            <tbody>
              {partidas.map(([clave, desc]) => [
                <tr key={clave} className="partida"><td>{clave}</td><td colSpan={10}>{desc}</td></tr>,
                ...presupuesto.filter((c) => c.partida_clave === clave).flatMap((c) => [
                  <tr key={c.concepto_id}>
                    <td>{c.clave}</td>
                    <td style={{ whiteSpace: 'normal', minWidth: 260 }}>{c.descripcion}</td>
                    <td>{c.unidad}</td>
                    <td className="n">{numero(c.cantidad_vigente)}</td>
                    <td className="n">{dinero(c.importe_costo_vigente)}</td>
                    <td className="n">{dinero(suma(c, 'imp_reservado'))}</td>
                    <td className="n">{dinero(suma(c, 'imp_comprometido'))}</td>
                    <td className="n">{dinero(suma(c, 'imp_ejercido'))}</td>
                    <td className="n">{dinero(suma(c, 'imp_pagado'))}</td>
                    <td className={`n ${suma(c, 'imp_disponible') < 0 ? 'neg' : ''}`}>{dinero(suma(c, 'imp_disponible'))}</td>
                    <td>
                      <div className="medidores" title={`Físico ${pct(c.pct_fisico)} · Financiero ${pct(c.pct_financiero)}`}>
                        <div className="medidor f"><span style={{ width: `${Math.min(100, c.pct_fisico)}%` }} /></div>
                        <div className="medidor d"><span style={{ width: `${Math.min(100, c.pct_financiero)}%` }} /></div>
                      </div>
                    </td>
                  </tr>,
                  ...c.lineas.map((l) => (
                    <tr key={l.linea_control_id} className="linea">
                      <td>{l.insumo_clave}</td>
                      <td>{l.insumo_descripcion}</td>
                      <td>{l.unidad}</td>
                      <td className="n">{numero(l.cantidad_vigente)}</td>
                      <td className="n">{dinero(l.importe_vigente)}</td>
                      <td className="n">{dinero(l.imp_reservado)}</td>
                      <td className="n">{dinero(l.imp_comprometido)}</td>
                      <td className="n">{dinero(l.imp_ejercido)}</td>
                      <td className="n">{dinero(l.imp_pagado)}</td>
                      <td className={`n ${l.imp_disponible < 0 ? 'neg' : ''}`}>{dinero(l.imp_disponible)}</td>
                      <td />
                    </tr>
                  )),
                ]),
              ])}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}

function Tarjeta({ et, val, alerta }: { et: string; val: string; alerta?: boolean }) {
  return (
    <div className="tarjeta">
      <div className="et">{et}</div>
      <div className={`val ${alerta ? 'neg' : ''}`}>{val}</div>
    </div>
  );
}
