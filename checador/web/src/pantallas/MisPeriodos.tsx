import { useState } from 'react';
import type { MiPeriodo } from '../../../server/src/tipos';
import { api } from '../api';
import { useSesion } from '../sesion';
import { Aviso, Cargando, Chip, useAccion, useCarga } from '../ui';

const fecha = (ymd: string) => ymd.split('-').reverse().join('/');

/** "Cada quien acepta": el trabajador revisa sus horas del periodo cerrado y acepta u objeta. */
export function MisPeriodos() {
  const { info } = useSesion();
  const { datos, error, recargar } = useCarga(() => api<MiPeriodo[]>('/api/yo/periodos'), [info.empresa.id]);
  return (
    <div className="movil">
      <div className="movil-cab"><div className="fila-cab"><a href="#/checar" style={{ color: '#fff' }}>← Checar</a>
        <strong>Mis periodos</strong><span /></div></div>
      <div className="movil-cuerpo">
        {!datos ? <div className="caja caja-in"><Cargando error={error} /></div> : datos.length === 0
          ? <div className="caja caja-in"><p className="tenue" style={{ margin: 0 }}>Aún no hay periodos cerrados.</p></div>
          : datos.map((p) => <Tarjeta key={p.id} p={p} alResponder={recargar} />)}
      </div>
    </div>
  );
}

function Tarjeta({ p, alResponder }: { p: MiPeriodo; alResponder: () => void }) {
  const [objetando, setObjetando] = useState(false);
  const [comentario, setComentario] = useState('');
  const { ocupado, error, correr } = useAccion();
  const responder = (acepta: boolean) => correr(async () => {
    await api(`/api/yo/periodos/${p.id}/respuesta`, { body: { acepta, comentario: comentario || undefined } });
    alResponder();
  });
  return (
    <div className="caja caja-in" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
        <div><h3 style={{ marginBottom: 2 }}>{p.nombre}</h3><span className="tenue">{fecha(p.inicio)} al {fecha(p.fin)}</span></div>
        {p.respuesta ? <Chip clase={p.respuesta}>{p.respuesta === 'ACEPTADO' ? 'Aceptaste' : 'Objetaste'}</Chip>
          : <Chip clase="PENDIENTE">Por revisar</Chip>}
      </div>
      <div className="tarjetas" style={{ marginTop: 14, gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div className="tarjeta"><div className="et">Horas</div><div className="val">{p.horas.toLocaleString('es-MX')}</div></div>
        <div className="tarjeta"><div className="et">Días</div><div className="val">{p.dias_trabajados}</div></div>
        <div className="tarjeta"><div className="et">Retardos</div><div className="val">{p.retardos}</div></div>
        <div className="tarjeta"><div className="et">Incidencias</div><div className="val">{p.incidencias + p.jornadas_abiertas}</div></div>
      </div>
      {p.correcciones > 0 && <p className="tenue">RH hizo {p.correcciones} {p.correcciones === 1 ? 'corrección' : 'correcciones'} en este periodo.</p>}
      {p.comentario && <p className="tenue">Tu comentario: “{p.comentario}”</p>}
      {!p.respuesta && (objetando ? (
        <>
          <label className="campo" style={{ marginTop: 12 }}><span>¿Qué no coincide?</span>
            <textarea rows={3} value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Ej. el jueves salí a las 19:00" /></label>
          <div className="fila">
            <button className="boton peligro" disabled={ocupado} onClick={() => void responder(false)}>Enviar objeción</button>
            <button className="boton" onClick={() => setObjetando(false)}>Cancelar</button>
          </div>
        </>
      ) : (
        <div className="fila" style={{ marginTop: 12 }}>
          <button className="boton verde" disabled={ocupado} onClick={() => void responder(true)}>Acepto mis horas</button>
          <button className="boton" onClick={() => setObjetando(true)}>No coincide</button>
        </div>
      ))}
      <Aviso>{error}</Aviso>
    </div>
  );
}
