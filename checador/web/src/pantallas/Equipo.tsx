import { useState, type FormEvent } from 'react';
import type { ChecadaVista, FilaEquipo, Tablero, TipoChecada } from '../../../server/src/tipos';
import { api } from '../api';
import { ALERTA, CHECADA, ESTADO, fechaLarga, hora, horas, instanteEnZona, MODALIDAD } from '../jornada';
import { puede, useSesion } from '../sesion';
import { Aviso, Campo, Cargando, Chip, Modal, Persona, useAccion, useCarga } from '../ui';

const TEXTO_INCIDENCIA: Record<string, (n: string) => string> = {
  FUERA_DE_ZONA: (n) => `${n} checó fuera de la zona.`,
  SIN_UBICACION: (n) => `${n} checó sin ubicación.`,
  SECUENCIA: (n) => `${n} registró una checada fuera de secuencia.`,
  RETARDO: (n) => `${n} llegó tarde.`,
};

/** "Así va tu equipo": en vivo, con lo que necesita atención arriba. */
export function Equipo() {
  const { info } = useSesion();
  const zona = info.empresa.zona_horaria;
  const [fecha, setFecha] = useState<string>('');
  const { datos: t, error, recargar } = useCarga(
    () => api<Tablero>(`/api/equipo/tablero${fecha ? `?fecha=${fecha}` : ''}`), [fecha, info.empresa.id], 30_000);
  const [abierto, setAbierto] = useState<FilaEquipo | null>(null);

  if (!t) return <Cargando error={error} />;
  const r = t.resumen;
  const sinLlegar = t.equipo.filter((e) => e.alertas.includes('NO_HA_LLEGADO'));
  return (
    <>
      <div className="encabezado">
        <div>
          <h1>Así va tu equipo</h1>
          <p className="tenue">
            {fechaLarga(t.fecha)} {t.es_hoy && <span className="vivo" style={{ marginLeft: 8 }}>En vivo</span>}
          </p>
        </div>
        <label className="fila" style={{ gap: 8, alignItems: 'center' }}>
          <span className="tenue">Día</span>
          <input className="entrada" style={{ width: 'auto' }} type="date" value={fecha || t.fecha}
            onChange={(e) => setFecha(e.target.value)} />
        </label>
      </div>

      <div className="tarjetas">
        <div className="tarjeta ok"><div className="et">Trabajando</div><div className="val">{r.trabajando}</div></div>
        <div className="tarjeta"><div className="et">En descanso</div><div className="val">{r.en_descanso}</div></div>
        <div className="tarjeta"><div className="et">Ya salieron</div><div className="val">{r.salieron}</div></div>
        <div className="tarjeta"><div className="et">Sin registro</div><div className="val">{r.sin_registro}</div></div>
        <div className={`tarjeta${r.requieren_atencion ? ' atencion' : ''}`}><div className="et">Requieren atención</div>
          <div className="val">{r.requieren_atencion}</div></div>
      </div>

      <div className="rejilla-2" style={{ marginTop: 18 }}>
        <div className="caja">
          <div className="tabla-wrap">
            <table>
              <thead><tr><th>Trabajador</th><th className="ocultar-movil">Centro</th><th>Estado</th><th>Última</th>
                <th className="n ocultar-movil">Hoy</th><th>Alertas</th></tr></thead>
              <tbody>
                {t.equipo.map((e) => (
                  <tr key={e.trabajador_id} className="clic" onClick={() => setAbierto(e)}>
                    <td><Persona nombre={e.nombre} detalle={`${e.numero}${e.puesto ? ` · ${e.puesto}` : ''}`} /></td>
                    <td className="ocultar-movil">{e.centro ?? '—'}</td>
                    <td><Chip clase={e.estado}>{ESTADO[e.estado]}</Chip></td>
                    <td className="num">{hora(e.ultima_checada, zona)}{e.modalidad && <small className="tenue" style={{ display: 'block' }}>{MODALIDAD[e.modalidad]}</small>}</td>
                    <td className="n ocultar-movil">{e.minutos_hoy ? horas(e.minutos_hoy) : '—'}</td>
                    <td>{e.alertas.map((a) => <Chip key={a} clase={a}>{ALERTA[a]}</Chip>)}</td>
                  </tr>
                ))}
                {t.equipo.length === 0 && <tr><td colSpan={6} className="vacio">Aún no hay trabajadores. Agrégalos en Trabajadores.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h3>Necesita atención</h3>
          {t.incidencias.length === 0 && sinLlegar.length === 0 && <p className="tenue">Todo en orden.</p>}
          {t.incidencias.map((i) => (
            <div key={i.checada_id} className={`alerta-linea${i.incidencias.some((x) => x !== 'RETARDO') ? ' roja' : ''}`}>
              <span className="ico">!</span>
              <div>
                <strong>{i.incidencias.map((x) => TEXTO_INCIDENCIA[x]?.(i.trabajador.split(' ')[0])).join(' ')}</strong>
                <div className="tenue" style={{ fontSize: 13 }}>
                  {CHECADA[i.tipo]} a las {hora(i.ocurrido_en, zona)}{i.distancia_m != null && i.incidencias.includes('FUERA_DE_ZONA')
                    ? ` · a ${i.distancia_m >= 1000 ? `${(i.distancia_m / 1000).toFixed(1)} km` : `${i.distancia_m} m`} del centro` : ''}.
                  {' '}Queda como incidencia para que la revises.
                </div>
              </div>
            </div>
          ))}
          {sinLlegar.map((e) => (
            <div key={e.trabajador_id} className="alerta-linea">
              <span className="ico">?</span>
              <div><strong>{e.nombre} no ha checado su entrada.</strong>
                <div className="tenue" style={{ fontSize: 13 }}>Ya pasó su hora de entrada más la tolerancia.</div></div>
            </div>
          ))}
        </div>
      </div>
      {abierto && <DiaTrabajador fila={abierto} fecha={t.fecha} alCerrar={() => { setAbierto(null); void recargar(); }} />}
    </>
  );
}

function DiaTrabajador({ fila, fecha, alCerrar }: { fila: FilaEquipo; fecha: string; alCerrar: () => void }) {
  const { info } = useSesion();
  const zona = info.empresa.zona_horaria;
  const { datos, error, recargar } = useCarga(
    () => api<ChecadaVista[]>(`/api/equipo/bitacora?fecha=${fecha}&trabajador_id=${fila.trabajador_id}`), [fila.trabajador_id, fecha]);
  const [anulando, setAnulando] = useState<ChecadaVista | null>(null);
  const [agregando, setAgregando] = useState(false);
  const gestiona = puede.gestionar(info);
  return (
    <Modal titulo={`${fila.nombre} · ${fechaLarga(fecha)}`} alCerrar={alCerrar}>
      {!datos ? <Cargando error={error} /> : datos.length === 0 ? <p className="tenue">Sin checadas este día.</p> : (
        <ul className="bitacora">
          {datos.map((c) => (
            <li key={c.id} className={c.anulada ? 'anulada' : undefined}>
              <span className="h">{hora(c.ocurrido_en, zona)}</span>
              <span className="q">{CHECADA[c.tipo]}
                <small>{c.medio === 'SUPERVISOR' ? `Corrección de RH: ${c.nota}` : `${c.modalidad ? MODALIDAD[c.modalidad] : ''}${c.centro ? ` · ${c.centro}` : ''}${c.distancia_m != null ? ` · ${c.distancia_m} m` : ''}`}
                  {c.anulada ? ' · anulada' : ''}</small></span>
              {c.incidencias.map((i) => <Chip key={i} clase={i}>{ALERTA[i]}</Chip>)}
              {gestiona && !c.anulada && <button className="boton chico peligro" onClick={() => setAnulando(c)}>Anular</button>}
            </li>
          ))}
        </ul>
      )}
      {gestiona && !agregando && !anulando && (
        <button className="boton" style={{ marginTop: 14 }} onClick={() => setAgregando(true)}>+ Agregar checada (corrección)</button>
      )}
      {agregando && <Correccion trabajadorId={fila.trabajador_id} fecha={fecha} alTerminar={() => { setAgregando(false); void recargar(); }} />}
      {anulando && <Anulacion checada={anulando} alTerminar={() => { setAnulando(null); void recargar(); }} />}
    </Modal>
  );
}

function Correccion({ trabajadorId, fecha, alTerminar }: { trabajadorId: string; fecha: string; alTerminar: () => void }) {
  const { info } = useSesion();
  const [tipo, setTipo] = useState<TipoChecada>('ENTRADA');
  const [h, setH] = useState('09:00');
  const [motivo, setMotivo] = useState('');
  const a = useAccion();
  const guardar = (e: FormEvent) => {
    e.preventDefault();
    void a.correr(async () => {
      await api('/api/equipo/correcciones', { body: {
        trabajador_id: trabajadorId, tipo, ocurrido_en: instanteEnZona(fecha, h, info.empresa.zona_horaria), motivo } });
      alTerminar();
    });
  };
  return (
    <form onSubmit={guardar} style={{ marginTop: 16, borderTop: '1px solid var(--borde)', paddingTop: 16 }}>
      <div className="fila">
        <Campo etiqueta="Tipo"><select value={tipo} onChange={(e) => setTipo(e.target.value as TipoChecada)}>
          {(Object.keys(CHECADA) as TipoChecada[]).map((k) => <option key={k} value={k}>{CHECADA[k]}</option>)}</select></Campo>
        <Campo etiqueta="Hora"><input type="time" value={h} onChange={(e) => setH(e.target.value)} required /></Campo>
      </div>
      <Campo etiqueta="Motivo" ayuda="Queda registrado con tu nombre; el trabajador lo verá al revisar su periodo.">
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. olvidó checar, celular sin batería" required minLength={5} />
      </Campo>
      <Aviso>{a.error}</Aviso>
      <div className="fila"><button className="boton primario" disabled={a.ocupado}>Guardar corrección</button>
        <button type="button" className="boton" onClick={alTerminar}>Cancelar</button></div>
    </form>
  );
}

function Anulacion({ checada, alTerminar }: { checada: ChecadaVista; alTerminar: () => void }) {
  const { info } = useSesion();
  const [motivo, setMotivo] = useState('');
  const a = useAccion();
  const guardar = (e: FormEvent) => {
    e.preventDefault();
    void a.correr(async () => {
      await api(`/api/equipo/checadas/${checada.id}/anular`, { body: { motivo } });
      alTerminar();
    });
  };
  return (
    <form onSubmit={guardar} style={{ marginTop: 16, borderTop: '1px solid var(--borde)', paddingTop: 16 }}>
      <p style={{ marginTop: 0 }}>Anular <b>{CHECADA[checada.tipo]} de las {hora(checada.ocurrido_en, info.empresa.zona_horaria)}</b>.
        No se borra: queda en la bitácora marcada como anulada.</p>
      <Campo etiqueta="Motivo"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} required minLength={5} /></Campo>
      <Aviso>{a.error}</Aviso>
      <div className="fila"><button className="boton peligro" disabled={a.ocupado}>Anular checada</button>
        <button type="button" className="boton" onClick={alTerminar}>Cancelar</button></div>
    </form>
  );
}
