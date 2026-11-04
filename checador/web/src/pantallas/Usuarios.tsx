import { useState, type FormEvent } from 'react';
import type { Rol, Usuario } from '../../../server/src/tipos';
import { api } from '../api';
import { puede, ROL, useSesion } from '../sesion';
import { Aviso, Campo, Cargando, Chip, Modal, Persona, useAccion, useCarga } from '../ui';

/** Quién entra a esta empresa y con qué rol. Los trabajadores se dan de alta desde su ficha. */
export function Usuarios() {
  const { info } = useSesion();
  const { datos, error, recargar } = useCarga(() => api<Usuario[]>('/api/usuarios'), [info.empresa.id]);
  const [nuevo, setNuevo] = useState(false);
  const a = useAccion();
  if (!datos) return <Cargando error={error} />;
  const roles: Rol[] = puede.administrar(info) ? ['ADMIN', 'RH', 'SUPERVISOR'] : ['SUPERVISOR'];
  const cambiar = (u: Usuario, body: object) => void a.correr(() => api(`/api/usuarios/${u.cuenta_id}`, { metodo: 'PATCH', body })).then(recargar);
  return (
    <>
      <div className="encabezado">
        <div><h1>Usuarios</h1><p className="tenue">Acceso a {info.empresa.nombre}. Una misma persona puede tener acceso a varias empresas con un solo correo.</p></div>
        <button className="boton primario" onClick={() => setNuevo(true)}>+ Dar acceso</button>
      </div>
      <Aviso>{a.error}</Aviso>
      <div className="caja"><div className="tabla-wrap"><table>
        <thead><tr><th>Persona</th><th>Rol</th><th className="ocultar-movil">Ficha</th><th>Acceso</th></tr></thead>
        <tbody>
          {datos.map((u) => {
            const propio = u.cuenta_id === info.cuenta.id;
            const editable = !propio && (puede.administrar(info) || !['ADMIN', 'RH'].includes(u.rol));
            return (
              <tr key={u.cuenta_id}>
                <td><Persona nombre={u.nombre} detalle={u.email} /></td>
                <td>{editable && u.rol !== 'TRABAJADOR' ? (
                  <select className="entrada" style={{ width: 'auto' }} value={u.rol} onChange={(e) => cambiar(u, { rol: e.target.value })}>
                    {roles.map((r) => <option key={r} value={r}>{ROL[r]}</option>)}</select>) : ROL[u.rol]}</td>
                <td className="ocultar-movil">{u.trabajador ?? '—'}</td>
                <td>{editable ? (
                  <button className={`boton chico${u.activa ? ' peligro' : ''}`} onClick={() => cambiar(u, { activa: !u.activa })}>
                    {u.activa ? 'Quitar acceso' : 'Devolver acceso'}</button>
                ) : <Chip clase={u.activa ? 'ACTIVO' : 'INACTIVO'}>{u.activa ? 'Activo' : 'Sin acceso'}</Chip>}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div></div>
      {nuevo && <Nuevo roles={roles} alCerrar={() => { setNuevo(false); void recargar(); }} />}
    </>
  );
}

function Nuevo({ roles, alCerrar }: { roles: Rol[]; alCerrar: () => void }) {
  const [f, setF] = useState({ email: '', nombre: '', rol: roles.at(-1) as Rol, password: '' });
  const a = useAccion();
  const guardar = (e: FormEvent) => {
    e.preventDefault();
    void a.correr(async () => {
      await api('/api/usuarios', { body: { ...f, password: f.password || undefined } });
      alCerrar();
    });
  };
  return (
    <Modal titulo="Dar acceso a la empresa" alCerrar={alCerrar}>
      <form onSubmit={guardar}>
        <Campo etiqueta="Correo"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Campo>
        <Campo etiqueta="Nombre"><input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required /></Campo>
        <Campo etiqueta="Rol"><select value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value as Rol })}>
          {roles.map((r) => <option key={r} value={r}>{ROL[r]}</option>)}</select></Campo>
        <Campo etiqueta="Contraseña inicial" ayuda="Sólo si la persona aún no tiene cuenta en ninguna empresa del grupo (mínimo 8).">
          <input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} minLength={8} /></Campo>
        <Aviso>{a.error}</Aviso>
        <button className="boton primario" disabled={a.ocupado}>Dar acceso</button>
      </form>
    </Modal>
  );
}
