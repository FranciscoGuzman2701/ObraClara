'use client';
import { useActionState } from 'react';
import { iniciarSesion } from '../acciones';

const DEMO = ['director@demo.mx', 'residente@demo.mx', 'compras@demo.mx', 'finanzas@demo.mx', 'cabo@demo.mx'];

export default function Login() {
  const [error, enviar, pendiente] = useActionState(iniciarSesion, null);
  return (
    <form className="login" action={enviar}>
      <h1>ObraClara</h1>
      <p className="sub">Acceso de desarrollo (sin contraseña)</p>
      <label htmlFor="email">Usuario</label>
      <select id="email" name="email" defaultValue={DEMO[0]}>
        {DEMO.map((e) => <option key={e}>{e}</option>)}
      </select>
      {error && <p className="error">{error}</p>}
      <p><button className="primario" disabled={pendiente}>{pendiente ? 'Entrando…' : 'Entrar'}</button></p>
    </form>
  );
}
