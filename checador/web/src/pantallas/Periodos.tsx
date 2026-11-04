import { useState, type FormEvent } from 'react';
import type { FilaPeriodo, Periodo } from '../../../server/src/tipos';
import { api, descargar, mensajeDe } from '../api';
import { hoyEn, quincena } from '../jornada';
import { useSesion } from '../sesion';
import { Aviso, Campo, Cargando, Chip, Persona, useAccion, useCarga } from '../ui';

const f = (ymd: string) => ymd.split('-').reverse().join('/');

export function Periodos() {
  const { info } = useSesion();
  const { datos, error, recargar } = useCarga(() => api<Periodo[]>('/api/periodos'), [info.empresa.id]);
  const sugerido = quincena(hoyEn(info.empresa.zona_horaria));
  const [n, setN] = useState(sugerido);
  const a = useAccion();
  if (!datos) return <Cargando error={error} />;
  const crear = (e: FormEvent) => {
    e.preventDefault();
    void a.correr(() => api('/api/periodos', { body: n })).then((ok) => { if (ok) void recargar(); });
  };
  const cerrar = (p: Periodo) => {
    if (!confirm(`¿Cerrar “${p.nombre}”? Las horas quedan congeladas y ya no se podrá checar ni corregir dentro del periodo.`)) return;
    void a.correr(() => api(`/api/periodos/${p.id}/cerrar`, { body: {} })).then((ok) => { if (ok) void recargar(); });
  };
  return (
    <>
      <div className="encabezado"><div><h1>Periodos</h1>
        <p className="tenue">Al cerrar, cada trabajador revisa sus horas en su celular y las acepta u objeta. Tú quedas respaldado.</p></div></div>
      <form className="caja caja-in fila" onSubmit={crear} style={{ marginBottom: 16 }}>
        <Campo etiqueta="Nombre"><input value={n.nombre} onChange={(e) => setN({ ...n, nombre: e.target.value })} required /></Campo>
        <Campo etiqueta="Del"><input type="date" value={n.inicio} onChange={(e) => setN({ ...n, inicio: e.target.value })} required /></Campo>
        <Campo etiqueta="Al"><input type="date" value={n.fin} onChange={(e) => setN({ ...n, fin: e.target.value })} required /></Campo>
        <div className="campo"><button className="boton primario" disabled={a.ocupado}>Crear periodo</button></div>
      </form>
      <Aviso>{a.error}</Aviso>
      <div className="caja"><div className="tabla-wrap"><table>
        <thead><tr><th>Periodo</th><th>Fechas</th><th>Estado</th><th className="n">Aceptaron</th><th className="n">Objetaron</th><th /></tr></thead>
        <tbody>
          {datos.map((p) => (
            <tr key={p.id}>
              <td>{p.estado === 'CERRADO' ? <a href={`#/periodos/${p.id}`}><strong>{p.nombre}</strong></a> : <strong>{p.nombre}</strong>}</td>
              <td className="num">{f(p.inicio)} – {f(p.fin)}</td>
              <td><Chip clase={p.estado}>{p.estado === 'CERRADO' ? 'Periodo cerrado' : 'Abierto'}</Chip></td>
              <td className="n">{p.estado === 'CERRADO' ? `${p.aceptados} / ${p.trabajadores}` : '—'}</td>
              <td className={`n${p.objetados ? ' rojo' : ''}`}>{p.estado === 'CERRADO' ? p.objetados : '—'}</td>
              <td>{p.estado === 'ABIERTO' ? <button className="boton chico" onClick={() => cerrar(p)}>Cerrar periodo</button>
                : <a className="boton chico" href={`#/periodos/${p.id}`}>Ver</a>}</td>
            </tr>
          ))}
          {datos.length === 0 && <tr><td colSpan={6} className="vacio">Crea tu primer periodo (quincena o semana)</td></tr>}
        </tbody>
      </table></div></div>
    </>
  );
}

export function PeriodoDetalle({ id }: { id: string }) {
  const { datos, error } = useCarga(() => api<{ periodo: Periodo; trabajadores: FilaPeriodo[] }>(`/api/periodos/${id}`), [id]);
  const [err, setErr] = useState<string | null>(null);
  if (!datos) return <Cargando error={error} />;
  const { periodo: p, trabajadores } = datos;
  const total = trabajadores.reduce((s, t) => s + t.horas, 0);
  return (
    <>
      <div className="encabezado">
        <div><a href="#/periodos">← Periodos</a><h1 style={{ marginTop: 6 }}>{p.nombre}</h1>
          <p className="tenue">{f(p.inicio)} al {f(p.fin)} · <Chip clase={p.estado}>{p.estado === 'CERRADO' ? 'Periodo cerrado' : 'Abierto'}</Chip></p></div>
        <button className="boton" onClick={() => descargar(`/api/periodos/${id}/csv`, `asistencia_${p.inicio}_${p.fin}.csv`)
          .catch((e) => setErr(mensajeDe(e)))}>Descargar CSV para nómina</button>
      </div>
      <Aviso>{err}</Aviso>
      <div className="tarjetas" style={{ marginBottom: 16 }}>
        <div className="tarjeta"><div className="et">Horas totales</div><div className="val">{Math.round(total).toLocaleString('es-MX')}</div></div>
        <div className="tarjeta ok"><div className="et">Aceptaron</div><div className="val">{trabajadores.filter((t) => t.respuesta === 'ACEPTADO').length}</div></div>
        <div className="tarjeta atencion"><div className="et">Objetaron</div><div className="val">{trabajadores.filter((t) => t.respuesta === 'OBJETADO').length}</div></div>
        <div className="tarjeta"><div className="et">Por responder</div><div className="val">{trabajadores.filter((t) => !t.respuesta).length}</div></div>
      </div>
      <div className="caja"><div className="tabla-wrap"><table>
        <thead><tr><th>Trabajador</th><th className="n">Horas</th><th className="n">Días</th><th className="n">Retardos</th>
          <th className="n">Incidencias</th><th className="n ocultar-movil">Correcciones</th><th className="n ocultar-movil">Sin salida</th><th>Respuesta</th></tr></thead>
        <tbody>
          {trabajadores.map((t) => (
            <tr key={t.trabajador_id}>
              <td><Persona nombre={t.nombre} detalle={t.numero} /></td>
              <td className="n">{t.horas.toLocaleString('es-MX')}</td>
              <td className="n">{t.dias_trabajados}</td>
              <td className={`n${t.retardos ? ' rojo' : ''}`}>{t.retardos}</td>
              <td className={`n${t.incidencias ? ' rojo' : ''}`}>{t.incidencias}</td>
              <td className="n ocultar-movil">{t.correcciones}</td>
              <td className={`n ocultar-movil${t.jornadas_abiertas ? ' rojo' : ''}`}>{t.jornadas_abiertas}</td>
              <td>{t.respuesta ? <Chip clase={t.respuesta}>{t.respuesta === 'ACEPTADO' ? 'Aceptó' : 'Objetó'}</Chip> : <Chip clase="PENDIENTE">Pendiente</Chip>}
                {t.comentario && <small className="tenue" style={{ display: 'block', maxWidth: 260 }}>“{t.comentario}”</small>}</td>
            </tr>
          ))}
        </tbody>
      </table></div></div>
    </>
  );
}
