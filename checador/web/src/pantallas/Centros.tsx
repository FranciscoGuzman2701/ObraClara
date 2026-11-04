import { useState, type FormEvent } from 'react';
import type { Centro } from '../../../server/src/tipos';
import { api } from '../api';
import { useSesion } from '../sesion';
import { Aviso, Campo, Cargando, Chip, Modal, useAccion, useCarga } from '../ui';

export function Centros() {
  const { info } = useSesion();
  const { datos, error, recargar } = useCarga(() => api<Centro[]>('/api/centros'), [info.empresa.id]);
  const [editando, setEditando] = useState<Centro | 'nuevo' | null>(null);
  if (!datos) return <Cargando error={error} />;
  return (
    <>
      <div className="encabezado">
        <div><h1>Centros de trabajo</h1><p className="tenue">Sucursales, oficinas u obras. La zona define dónde vale checar en “lugar fijo”.</p></div>
        <button className="boton primario" onClick={() => setEditando('nuevo')}>+ Nuevo centro</button>
      </div>
      <div className="caja"><div className="tabla-wrap"><table>
        <thead><tr><th>Clave</th><th>Nombre</th><th className="ocultar-movil">Dirección</th><th>Zona</th><th>Estado</th></tr></thead>
        <tbody>
          {datos.map((c) => (
            <tr key={c.id} className="clic" onClick={() => setEditando(c)}>
              <td><strong>{c.clave}</strong></td><td>{c.nombre}</td><td className="ocultar-movil">{c.direccion ?? '—'}</td>
              <td>{c.lat != null ? `${c.radio_m} m alrededor` : <span className="tenue">Sin ubicación</span>}</td>
              <td><Chip clase={c.activo ? 'ACTIVO' : 'INACTIVO'}>{c.activo ? 'Activo' : 'Inactivo'}</Chip></td>
            </tr>
          ))}
          {datos.length === 0 && <tr><td colSpan={5} className="vacio">Agrega tu primer centro de trabajo</td></tr>}
        </tbody>
      </table></div></div>
      {editando && <FormCentro c={editando === 'nuevo' ? null : editando} alCerrar={() => { setEditando(null); void recargar(); }} />}
    </>
  );
}

function FormCentro({ c, alCerrar }: { c: Centro | null; alCerrar: () => void }) {
  const [f, setF] = useState({
    clave: c?.clave ?? '', nombre: c?.nombre ?? '', direccion: c?.direccion ?? '',
    lat: c?.lat?.toString() ?? '', lng: c?.lng?.toString() ?? '', radio_m: String(c?.radio_m ?? 150), activo: c?.activo ?? true,
  });
  const a = useAccion();
  const set = (x: Partial<typeof f>) => setF({ ...f, ...x });
  const aqui = () => navigator.geolocation?.getCurrentPosition(
    (p) => set({ lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }),
    () => a.setError('No se pudo obtener la ubicación (permiso de GPS)'), { enableHighAccuracy: true, timeout: 10_000 });
  const guardar = (e: FormEvent) => {
    e.preventDefault();
    void a.correr(async () => {
      const body = { nombre: f.nombre, direccion: f.direccion || null, lat: f.lat ? Number(f.lat) : null,
        lng: f.lng ? Number(f.lng) : null, radio_m: Number(f.radio_m) };
      if (c) await api(`/api/centros/${c.id}`, { metodo: 'PATCH', body: { ...body, activo: f.activo } });
      else await api('/api/centros', { body: { ...body, clave: f.clave, direccion: f.direccion || undefined } });
      alCerrar();
    });
  };
  const mapa = f.lat && f.lng ? `https://www.openstreetmap.org/?mlat=${f.lat}&mlon=${f.lng}#map=17/${f.lat}/${f.lng}` : null;
  return (
    <Modal titulo={c ? c.nombre : 'Nuevo centro'} alCerrar={alCerrar}>
      <form onSubmit={guardar}>
        <div className="fila">
          <Campo etiqueta="Clave"><input value={f.clave} onChange={(e) => set({ clave: e.target.value.toUpperCase() })} disabled={!!c} required maxLength={12} placeholder="CEN" /></Campo>
          <Campo etiqueta="Nombre"><input value={f.nombre} onChange={(e) => set({ nombre: e.target.value })} required placeholder="Sucursal Centro" /></Campo>
        </div>
        <Campo etiqueta="Dirección"><input value={f.direccion} onChange={(e) => set({ direccion: e.target.value })} /></Campo>
        <div className="fila">
          <Campo etiqueta="Latitud"><input inputMode="decimal" value={f.lat} onChange={(e) => set({ lat: e.target.value })} /></Campo>
          <Campo etiqueta="Longitud"><input inputMode="decimal" value={f.lng} onChange={(e) => set({ lng: e.target.value })} /></Campo>
          <Campo etiqueta="Radio de la zona (m)"><input type="number" min={10} max={5000} value={f.radio_m} onChange={(e) => set({ radio_m: e.target.value })} /></Campo>
        </div>
        <div className="fila" style={{ marginBottom: 14 }}>
          <button type="button" className="boton chico" onClick={aqui}>📍 Usar mi ubicación actual</button>
          {mapa && <a className="boton chico" href={mapa} target="_blank" rel="noreferrer">Ver en el mapa</a>}
        </div>
        {c && <label className="casilla" style={{ marginBottom: 14 }}><input type="checkbox" checked={f.activo} onChange={(e) => set({ activo: e.target.checked })} />Activo</label>}
        <Aviso>{a.error}</Aviso>
        <button className="boton primario" disabled={a.ocupado}>Guardar</button>
      </form>
    </Modal>
  );
}
