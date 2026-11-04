import { useState, type FormEvent } from 'react';
import type { Centro, Modalidad, Trabajador } from '../../../server/src/tipos';
import { api } from '../api';
import { MODALIDAD } from '../jornada';
import { puede, useSesion } from '../sesion';
import { Aviso, Campo, Cargando, Chip, Modal, Persona, useAccion, useCarga } from '../ui';

const AYUDA_MOD: Record<Modalidad, string> = {
  LUGAR_FIJO: 'Celular, sólo dentro de la zona de su centro',
  DESDE_CASA: 'Celular, home office (sin zona)',
  MOVIL: 'Celular, visitas a cliente (guarda ubicación)',
  KIOSCO: 'Tableta compartida con número + PIN',
};

export function Trabajadores() {
  const { info } = useSesion();
  const { datos, error, recargar } = useCarga(() => Promise.all([
    api<Trabajador[]>('/api/trabajadores'), api<Centro[]>('/api/centros')]), [info.empresa.id]);
  const [editando, setEditando] = useState<Trabajador | 'nuevo' | null>(null);
  const [filtro, setFiltro] = useState('');
  if (!datos) return <Cargando error={error} />;
  const [lista, centros] = datos;
  const gestiona = puede.gestionar(info);
  const visibles = lista.filter((t) => `${t.numero} ${t.nombre} ${t.puesto ?? ''}`.toLowerCase().includes(filtro.toLowerCase()));
  return (
    <>
      <div className="encabezado">
        <div><h1>Trabajadores</h1><p className="tenue">{lista.filter((t) => t.activo).length} activos en {info.empresa.nombre}</p></div>
        <div className="fila">
          <input className="entrada" style={{ width: 220 }} placeholder="Buscar…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          {gestiona && <button className="boton primario" onClick={() => setEditando('nuevo')}>+ Nuevo trabajador</button>}
        </div>
      </div>
      <div className="caja"><div className="tabla-wrap"><table>
        <thead><tr><th>Trabajador</th><th>Centro</th><th>Cómo checa</th><th className="ocultar-movil">Entrada</th>
          <th className="ocultar-movil">Celular</th><th>Estado</th></tr></thead>
        <tbody>
          {visibles.map((t) => (
            <tr key={t.id} className={gestiona ? 'clic' : undefined} onClick={() => gestiona && setEditando(t)}>
              <td><Persona nombre={t.nombre} detalle={`${t.numero}${t.puesto ? ` · ${t.puesto}` : ''}`} /></td>
              <td>{t.centro ?? '—'}</td>
              <td>{t.modalidades.map((m) => <Chip key={m} clase="neutro sin-punto">{MODALIDAD[m]}</Chip>)}</td>
              <td className="ocultar-movil num">{t.hora_entrada ?? 'Libre'}</td>
              <td className="ocultar-movil">{t.cuenta_email ?? <span className="tenue">—</span>}</td>
              <td>{!t.activo ? <Chip clase="INACTIVO">Baja</Chip> : t.bloqueado ? <Chip clase="OBJETADO">PIN bloqueado</Chip>
                : <Chip clase="ACTIVO">Activo</Chip>}</td>
            </tr>
          ))}
          {visibles.length === 0 && <tr><td colSpan={6} className="vacio">Sin resultados</td></tr>}
        </tbody>
      </table></div></div>
      {editando && <FormTrabajador t={editando === 'nuevo' ? null : editando} centros={centros}
        alCerrar={() => { setEditando(null); void recargar(); }} />}
    </>
  );
}

function FormTrabajador({ t, centros, alCerrar }: { t: Trabajador | null; centros: Centro[]; alCerrar: () => void }) {
  const [f, setF] = useState({
    numero: t?.numero ?? '', nombre: t?.nombre ?? '', puesto: t?.puesto ?? '', centro_id: t?.centro_id ?? '',
    modalidades: t?.modalidades ?? (['LUGAR_FIJO'] as Modalidad[]), hora_entrada: t?.hora_entrada ?? '',
    jornada_h: String((t?.jornada_min ?? 480) / 60), pin: '', activo: t?.activo ?? true,
  });
  const a = useAccion();
  const set = (c: Partial<typeof f>) => setF({ ...f, ...c });
  const alternar = (m: Modalidad) =>
    set({ modalidades: f.modalidades.includes(m) ? f.modalidades.filter((x) => x !== m) : [...f.modalidades, m] });

  const guardar = (e: FormEvent) => {
    e.preventDefault();
    void a.correr(async () => {
      const comun = {
        nombre: f.nombre, puesto: f.puesto || undefined, centro_id: f.centro_id || null, modalidades: f.modalidades,
        hora_entrada: f.hora_entrada || null, jornada_min: Math.round(Number(f.jornada_h) * 60), pin: f.pin || undefined,
      };
      if (t) await api(`/api/trabajadores/${t.id}`, { metodo: 'PATCH', body: { ...comun, activo: f.activo } });
      else await api('/api/trabajadores', { body: { ...comun, numero: f.numero } });
      alCerrar();
    });
  };
  return (
    <Modal titulo={t ? `${t.numero} · ${t.nombre}` : 'Nuevo trabajador'} alCerrar={alCerrar}>
      <form onSubmit={guardar}>
        <div className="fila">
          <Campo etiqueta="Número"><input value={f.numero} onChange={(e) => set({ numero: e.target.value })} disabled={!!t} required
            pattern="[0-9A-Za-z\-]{1,12}" placeholder="014" /></Campo>
          <Campo etiqueta="Nombre"><input value={f.nombre} onChange={(e) => set({ nombre: e.target.value })} required /></Campo>
        </div>
        <div className="fila">
          <Campo etiqueta="Puesto"><input value={f.puesto} onChange={(e) => set({ puesto: e.target.value })} /></Campo>
          <Campo etiqueta="Centro de trabajo"><select value={f.centro_id} onChange={(e) => set({ centro_id: e.target.value })}>
            <option value="">— Sin centro —</option>
            {centros.filter((c) => c.activo).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Campo>
        </div>
        <div className="campo"><span>Cómo puede checar</span>
          <div className="casillas">{(Object.keys(MODALIDAD) as Modalidad[]).map((m) => (
            <label key={m} className="casilla" title={AYUDA_MOD[m]}>
              <input type="checkbox" checked={f.modalidades.includes(m)} onChange={() => alternar(m)} />{MODALIDAD[m]}</label>))}
          </div>
          <small className="tenue">{f.modalidades.map((m) => AYUDA_MOD[m]).join(' · ')}</small>
        </div>
        <div className="fila">
          <Campo etiqueta="Hora de entrada" ayuda="Vacío = horario libre (sin retardos)">
            <input type="time" value={f.hora_entrada} onChange={(e) => set({ hora_entrada: e.target.value })} /></Campo>
          <Campo etiqueta="Jornada (horas)"><input type="number" min={1} max={24} step={0.5} value={f.jornada_h}
            onChange={(e) => set({ jornada_h: e.target.value })} /></Campo>
          <Campo etiqueta={t?.tiene_pin ? 'Nuevo PIN (opcional)' : 'PIN de kiosco'} ayuda="4 a 6 dígitos">
            <input inputMode="numeric" pattern="\d{4,6}" value={f.pin} onChange={(e) => set({ pin: e.target.value })}
              required={!t?.tiene_pin && f.modalidades.includes('KIOSCO')} /></Campo>
        </div>
        {t && <label className="casilla" style={{ marginBottom: 14 }}><input type="checkbox" checked={f.activo}
          onChange={(e) => set({ activo: e.target.checked })} />Activo (desmarcar para dar de baja)</label>}
        <Aviso>{a.error}</Aviso>
        <div className="fila">
          <button className="boton primario" disabled={a.ocupado}>{t ? 'Guardar' : 'Dar de alta'}</button>
          {t?.bloqueado && <button type="button" className="boton" onClick={() => void a.correr(async () => {
            await api(`/api/trabajadores/${t.id}`, { metodo: 'PATCH', body: { desbloquear: true } }); alCerrar(); })}>Desbloquear PIN</button>}
        </div>
      </form>
      {t && !t.cuenta_email && t.activo && <AccesoCelular t={t} alListo={alCerrar} />}
    </Modal>
  );
}

/** Crea la cuenta con la que el trabajador checa desde su celular. */
function AccesoCelular({ t, alListo }: { t: Trabajador; alListo: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const a = useAccion();
  if (!t.modalidades.some((m) => m !== 'KIOSCO')) return null;
  return (
    <form style={{ borderTop: '1px solid var(--borde)', marginTop: 18, paddingTop: 16 }} onSubmit={(e) => {
      e.preventDefault();
      void a.correr(async () => {
        await api('/api/usuarios', { body: { email, nombre: t.nombre, rol: 'TRABAJADOR', trabajador_id: t.id, password: password || undefined } });
        alListo();
      });
    }}>
      <h3>Acceso desde su celular</h3>
      <p className="tenue" style={{ marginTop: 0 }}>Si el correo ya tiene cuenta en otra empresa del grupo, se usa la misma contraseña.</p>
      <div className="fila">
        <Campo etiqueta="Correo"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Campo>
        <Campo etiqueta="Contraseña inicial"><input value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} /></Campo>
      </div>
      <Aviso>{a.error}</Aviso>
      <button className="boton" disabled={a.ocupado}>Crear acceso</button>
    </form>
  );
}
