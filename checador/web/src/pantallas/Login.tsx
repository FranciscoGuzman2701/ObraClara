import { useState, type FormEvent } from 'react';
import type { InfoSesion } from '../../../server/src/tipos';
import { entrar } from '../api';
import { Aviso, Campo, useAccion } from '../ui';

const DEMO = ['dueno@grupo.mx', 'rh@p3.mx', 'supervisor@p3.mx', 'ana@p3.mx', 'diego@p3.mx', 'rh@e2.mx'];

export function Login({ alEntrar }: { alEntrar: (i: InfoSesion) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { ocupado, error, correr } = useAccion();
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    void correr(async () => alEntrar(await entrar(email.trim(), password)));
  };
  return (
    <div className="login">
      <form className="login-caja" onSubmit={enviar}>
        <div className="marca"><img src="/icono.svg" alt="" />Checador</div>
        <h1>Entrar</h1>
        <p className="tenue" style={{ marginTop: 0 }}>Con el correo y la contraseña que te dio tu empresa.</p>
        <Campo etiqueta="Correo">
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Campo>
        <Campo etiqueta="Contraseña">
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Campo>
        <Aviso>{error}</Aviso>
        <button className="boton primario" style={{ width: '100%' }} disabled={ocupado}>{ocupado ? 'Entrando…' : 'Entrar'}</button>
        {import.meta.env.DEV && (
          <Aviso tipo="info">
            Demo (contraseña <b>demo1234</b>):{' '}
            {DEMO.map((d, i) => (
              <span key={d}>{i > 0 && ' · '}
                <button type="button" className="boton enlace" onClick={() => { setEmail(d); setPassword('demo1234'); }}>{d}</button>
              </span>
            ))}
          </Aviso>
        )}
        <div className="login-pie"><a href="#/kiosco">Usar este dispositivo como kiosco</a></div>
      </form>
    </div>
  );
}
