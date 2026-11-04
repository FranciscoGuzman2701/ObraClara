import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { puede, ROL, useSesion } from '../sesion';
import { Aviso, Campo, Cargando, useAccion, useCarga } from '../ui';

interface Empresa { id: string; clave: string; nombre: string; rfc: string | null; zona_horaria: string; tolerancia_min: number }
const ZONAS = ['America/Mexico_City', 'America/Monterrey', 'America/Merida', 'America/Cancun', 'America/Chihuahua',
  'America/Hermosillo', 'America/Mazatlan', 'America/Tijuana'];

export function Ajustes({ movil }: { movil?: boolean }) {
  const { info } = useSesion();
  const contenido = (
    <>
      <h1>Ajustes</h1>
      <p className="tenue">{info.cuenta.nombre} · {info.cuenta.email} · {ROL[info.rol]} en {info.empresa.nombre}</p>
      <div className={movil ? '' : 'rejilla-2'}>
        {puede.administrar(info) && <DatosEmpresa />}
        <CambiarPassword />
      </div>
    </>
  );
  if (!movil) return contenido;
  return (
    <div className="movil">
      <div className="movil-cab"><div className="fila-cab"><a href="#/checar" style={{ color: '#fff' }}>← Checar</a><span /></div></div>
      <div className="movil-cuerpo"><div className="caja caja-in">{contenido}</div></div>
    </div>
  );
}

function DatosEmpresa() {
  const { info, actualizar } = useSesion();
  const { datos, error } = useCarga(() => api<Empresa>('/api/empresa'), [info.empresa.id]);
  const [f, setF] = useState<Partial<Empresa>>({});
  const a = useAccion();
  const [ok, setOk] = useState(false);
  if (!datos) return <div className="caja caja-in"><Cargando error={error} /></div>;
  const v = { ...datos, ...f };
  const guardar = (e: FormEvent) => {
    e.preventDefault();
    setOk(false);
    void a.correr(async () => {
      await api('/api/empresa', { metodo: 'PATCH', body: { nombre: v.nombre, rfc: v.rfc || null, tolerancia_min: v.tolerancia_min, zona_horaria: v.zona_horaria } });
      actualizar(await api('/api/sesion'));
      setOk(true);
    });
  };
  return (
    <form className="caja caja-in" onSubmit={guardar}>
      <h3>Empresa {datos.clave}</h3>
      <Campo etiqueta="Nombre"><input value={v.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required /></Campo>
      <Campo etiqueta="RFC"><input value={v.rfc ?? ''} onChange={(e) => setF({ ...f, rfc: e.target.value })} maxLength={13} /></Campo>
      <div className="fila">
        <Campo etiqueta="Tolerancia de retardo (min)" ayuda="Después de la hora de entrada + tolerancia se marca retardo.">
          <input type="number" min={0} max={120} value={v.tolerancia_min} onChange={(e) => setF({ ...f, tolerancia_min: Number(e.target.value) })} />
        </Campo>
        <Campo etiqueta="Zona horaria">
          <select value={v.zona_horaria} onChange={(e) => setF({ ...f, zona_horaria: e.target.value })}>
            {ZONAS.map((z) => <option key={z} value={z}>{z.replace('America/', '').replace('_', ' ')}</option>)}
          </select>
        </Campo>
      </div>
      <Aviso>{a.error}</Aviso>
      {ok && <Aviso tipo="ok">Guardado</Aviso>}
      <button className="boton primario" disabled={a.ocupado}>Guardar</button>
    </form>
  );
}

function CambiarPassword() {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const a = useAccion();
  const [ok, setOk] = useState(false);
  const guardar = (e: FormEvent) => {
    e.preventDefault();
    setOk(false);
    void a.correr(async () => {
      await api('/api/sesion/password', { body: { actual, nueva } });
      setActual(''); setNueva(''); setOk(true);
    });
  };
  return (
    <form className="caja caja-in" onSubmit={guardar}>
      <h3>Cambiar contraseña</h3>
      <Campo etiqueta="Contraseña actual"><input type="password" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} required /></Campo>
      <Campo etiqueta="Nueva contraseña" ayuda="Mínimo 8 caracteres. Sirve para todas tus empresas.">
        <input type="password" autoComplete="new-password" minLength={8} value={nueva} onChange={(e) => setNueva(e.target.value)} required />
      </Campo>
      <Aviso>{a.error}</Aviso>
      {ok && <Aviso tipo="ok">Contraseña actualizada</Aviso>}
      <button className="boton primario" disabled={a.ocupado}>Cambiar</button>
    </form>
  );
}
