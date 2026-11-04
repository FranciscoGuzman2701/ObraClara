import { useState, type FormEvent } from 'react';
import type { Centro, Dispositivo } from '../../../server/src/tipos';
import { api, tokenKiosco } from '../api';
import { hora } from '../jornada';
import { ir } from '../ruta';
import { useSesion } from '../sesion';
import { Aviso, Campo, Cargando, Chip, Modal, useAccion, useCarga } from '../ui';

const cuando = (iso: string | null) => (iso ? `${new Date(iso).toLocaleDateString('es-MX')} ${hora(iso)}` : '—');

export function Kioscos() {
  const { info } = useSesion();
  const { datos, error, recargar } = useCarga(() => Promise.all([
    api<Dispositivo[]>('/api/dispositivos'), api<Centro[]>('/api/centros')]), [info.empresa.id]);
  const [activando, setActivando] = useState(false);
  const a = useAccion();
  if (!datos) return <Cargando error={error} />;
  const [lista, centros] = datos;
  return (
    <>
      <div className="encabezado">
        <div><h1>Kioscos</h1><p className="tenue">Tabletas compartidas donde se checa con número de trabajador + PIN.</p></div>
        <button className="boton primario" onClick={() => setActivando(true)}>+ Activar tableta</button>
      </div>
      <Aviso>{a.error}</Aviso>
      <div className="caja"><div className="tabla-wrap"><table>
        <thead><tr><th>Tableta</th><th>Centro</th><th className="ocultar-movil">Activada</th><th>Último uso</th><th>Estado</th><th /></tr></thead>
        <tbody>
          {lista.map((d) => (
            <tr key={d.id}>
              <td><strong>{d.nombre}</strong></td><td>{d.centro}</td><td className="ocultar-movil">{cuando(d.creado_en)}</td>
              <td>{cuando(d.ultimo_uso)}</td>
              <td><Chip clase={d.revocado_en ? 'INACTIVO' : 'ACTIVO'}>{d.revocado_en ? 'Desactivada' : 'Activa'}</Chip></td>
              <td>{!d.revocado_en && <button className="boton chico peligro" onClick={() => {
                if (confirm(`¿Desactivar “${d.nombre}”? Dejará de aceptar checadas.`)) {
                  void a.correr(() => api(`/api/dispositivos/${d.id}/revocar`, { body: {} })).then(recargar);
                }
              }}>Desactivar</button>}</td>
            </tr>
          ))}
          {lista.length === 0 && <tr><td colSpan={6} className="vacio">Aún no hay tabletas activadas</td></tr>}
        </tbody>
      </table></div></div>
      {activando && <Activar centros={centros.filter((c) => c.activo)} alCerrar={() => { setActivando(false); void recargar(); }} />}
    </>
  );
}

function Activar({ centros, alCerrar }: { centros: Centro[]; alCerrar: () => void }) {
  const [centro, setCentro] = useState(centros[0]?.id ?? '');
  const [nombre, setNombre] = useState('Tableta recepción');
  const [codigo, setCodigo] = useState<string | null>(null);
  const a = useAccion();
  const generar = (e: FormEvent) => {
    e.preventDefault();
    void a.correr(async () => {
      const r = await api<{ token: string }>('/api/kiosco/activar', { body: { centro_id: centro, nombre } });
      setCodigo(r.token);
    });
  };
  const usarAqui = () => {
    if (!codigo) return;
    tokenKiosco.set(codigo);
    ir('/kiosco');
  };
  return (
    <Modal titulo="Activar tableta como kiosco" alCerrar={alCerrar}>
      {!codigo ? (
        <form onSubmit={generar}>
          <Campo etiqueta="Centro donde quedará la tableta"><select value={centro} onChange={(e) => setCentro(e.target.value)} required>
            {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Campo>
          <Campo etiqueta="Nombre de la tableta"><input value={nombre} onChange={(e) => setNombre(e.target.value)} required /></Campo>
          <Aviso>{a.error}</Aviso>
          <button className="boton primario" disabled={a.ocupado || !centro}>Generar código</button>
        </form>
      ) : (
        <>
          <p>Código de activación (sólo se muestra esta vez):</p>
          <p className="caja caja-in num" style={{ fontSize: 18, fontWeight: 800, wordBreak: 'break-all', userSelect: 'all' }}>{codigo}</p>
          <p className="tenue">En la tableta, abre esta app y elige <b>“Usar este dispositivo como kiosco”</b>; pega el código. O, si estás en la tableta ahora:</p>
          <div className="fila"><button className="boton primario" onClick={usarAqui}>Usar ESTE dispositivo como kiosco</button>
            <button className="boton" onClick={alCerrar}>Listo</button></div>
        </>
      )}
    </Modal>
  );
}
