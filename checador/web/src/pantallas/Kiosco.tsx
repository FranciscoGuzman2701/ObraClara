import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChecadaRegistrada, TipoChecada } from '../../../server/src/tipos';
import { api, ApiError, mensajeDe, tokenKiosco } from '../api';
import { abrirCamara, capturar, cerrarCamara } from '../camara';
import { ALERTA, fechaLarga, hora, hoyEn, REGISTRADA, saludo } from '../jornada';
import { Aviso, useAhora } from '../ui';

interface InfoKiosco { empresa: string; clave: string; centro: string }
type Paso = { p: 'numero' } | { p: 'pin'; numero: string } | { p: 'listo'; r: ChecadaRegistrada & { siguientes: TipoChecada[] } }
  | { p: 'error'; mensaje: string };

/** Tableta compartida: el trabajador teclea su número y su PIN. */
export function Kiosco() {
  const [codigo, setCodigo] = useState(tokenKiosco.get());
  const [info, setInfo] = useState<InfoKiosco | null>(null);
  const [falla, setFalla] = useState<string | null>(null);

  useEffect(() => {
    if (!codigo) return;
    api<InfoKiosco>('/api/kiosco', { kiosco: true }).then((i) => { setInfo(i); setFalla(null); }).catch((e) => {
      if (e instanceof ApiError && e.status === 401) { tokenKiosco.set(null); setCodigo(null); setFalla(e.message); }
      else setFalla(mensajeDe(e));
    });
  }, [codigo]);

  if (!codigo) return <Activar falla={falla} alActivar={(c) => { tokenKiosco.set(c); setCodigo(c); }} />;
  if (!info) return <div className="kiosco"><p className="lugar" style={{ marginTop: '30vh' }}>{falla ?? 'Conectando…'}</p></div>;
  return <Teclado info={info} alDesactivar={() => { tokenKiosco.set(null); setCodigo(null); setInfo(null); }} />;
}

function Activar({ falla, alActivar }: { falla: string | null; alActivar: (codigo: string) => void }) {
  const [c, setC] = useState('');
  const [error, setError] = useState(falla);
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    tokenKiosco.set(c.trim());
    try {
      await api('/api/kiosco', { kiosco: true });
      alActivar(c.trim());
    } catch (err) {
      tokenKiosco.set(null);
      setError(mensajeDe(err));
    }
  };
  return (
    <div className="login">
      <form className="login-caja" onSubmit={enviar}>
        <div className="marca"><img src="/icono.svg" alt="" />Checador · Kiosco</div>
        <h1>Activar esta tableta</h1>
        <p className="tenue">RH genera el código en <b>Kioscos → Activar tableta</b> (o activa la tableta directamente desde ahí con su sesión).</p>
        <label className="campo"><span>Código de activación</span>
          <input value={c} onChange={(e) => setC(e.target.value)} autoComplete="off" required /></label>
        <Aviso>{error}</Aviso>
        <button className="boton primario" style={{ width: '100%' }}>Activar</button>
        <div className="login-pie"><a href="#/">Volver al inicio de sesión</a></div>
      </form>
    </div>
  );
}

function Teclado({ info, alDesactivar }: { info: InfoKiosco; alDesactivar: () => void }) {
  const ahora = useAhora();
  const [paso, setPaso] = useState<Paso>({ p: 'numero' });
  const [valor, setValor] = useState('');
  const [enviando, setEnviando] = useState(false);
  const reinicio = useRef<ReturnType<typeof setTimeout>>(undefined);
  // si la tableta tiene cámara, cada checada lleva foto: desanima prestar el PIN
  const video = useRef<HTMLVideoElement>(null);
  const [conCamara, setConCamara] = useState(false);
  useEffect(() => {
    let s: MediaStream | null = null;
    let vivo = true;
    if (video.current) abrirCamara(video.current).then((x) => { if (vivo) { s = x; setConCamara(true); } else cerrarCamara(x); })
      .catch(() => setConCamara(false));
    return () => { vivo = false; cerrarCamara(s); };
  }, []);

  const volver = useCallback(() => { setPaso({ p: 'numero' }); setValor(''); }, []);
  // regresa solo al inicio: tras mostrar el resultado, o si alguien deja el PIN a medias
  useEffect(() => {
    clearTimeout(reinicio.current);
    if (paso.p === 'listo' || paso.p === 'error') reinicio.current = setTimeout(volver, paso.p === 'listo' ? 5000 : 6000);
    else if (paso.p === 'pin' || valor) reinicio.current = setTimeout(volver, 30_000);
    return () => clearTimeout(reinicio.current);
  }, [paso, valor, volver]);

  const foto = () => {
    if (!conCamara || !video.current) return {};
    try { return { foto: { base64: capturar(video.current, 360, 0.55) } }; } catch { return {}; }
  };
  const aceptar = useCallback(async () => {
    if (enviando || !valor) return;
    if (paso.p === 'numero') { setPaso({ p: 'pin', numero: valor }); setValor(''); return; }
    if (paso.p !== 'pin') return;
    setEnviando(true);
    try {
      const r = await api<ChecadaRegistrada & { siguientes: TipoChecada[] }>('/api/kiosco/checar', {
        kiosco: true, body: { numero: paso.numero, pin: valor, client_uuid: crypto.randomUUID(), ...foto() } });
      setPaso({ p: 'listo', r });
    } catch (e) {
      setPaso({ p: 'error', mensaje: mensajeDe(e) });
    } finally {
      setValor('');
      setEnviando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enviando, paso, valor, conCamara]);

  const tecla = useCallback((k: string) => {
    if (paso.p === 'listo' || paso.p === 'error') { volver(); return; }
    if (k === 'borrar') setValor((v) => v.slice(0, -1));
    else if (k === 'ok') void aceptar();
    else setValor((v) => (v.length < (paso.p === 'pin' ? 6 : 12) ? v + k : v));
  }, [aceptar, paso.p, volver]);

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) tecla(e.key);
      else if (e.key === 'Backspace') tecla('borrar');
      else if (e.key === 'Enter') tecla('ok');
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [tecla]);

  const primerNombre = paso.p === 'listo' ? paso.r.trabajador.split(' ')[0] : '';
  return (
    <div className="kiosco">
      <div className="lugar">{info.clave} · {info.centro}</div>
      <div className="reloj-grande">{hora(ahora)}</div>
      <div className="fecha">{fechaLarga(hoyEn())}</div>
      <video ref={video} className="kiosco-camara" autoPlay muted playsInline style={{ display: conCamara ? 'block' : 'none' }} />
      <div className="kiosco-caja">
        {paso.p === 'listo' ? (
          <div className="resultado" onClick={volver}>
            <div className="check">✓</div>
            <div className="grande">¡{saludo(ahora)}, {primerNombre}!</div>
            <div style={{ fontSize: 18 }}>{REGISTRADA[paso.r.tipo]} · {hora(paso.r.ocurrido_en)}</div>
            {paso.r.incidencias.map((i) => <p key={i} className="aviso error">{ALERTA[i]}</p>)}
          </div>
        ) : paso.p === 'error' ? (
          <div className="resultado" onClick={volver}>
            <div className="check mal">!</div>
            <div className="grande" style={{ fontSize: 22 }}>{paso.mensaje}</div>
            <p className="tenue" style={{ color: '#c9d5ea' }}>Toque para intentar de nuevo</p>
          </div>
        ) : (
          <>
            <p className="paso">{paso.p === 'numero' ? 'Escribe tu número de trabajador' : `Trabajador ${paso.numero} · escribe tu PIN`}</p>
            <div className="pantalla-num" aria-live="polite">{paso.p === 'pin' ? '•'.repeat(valor.length) : valor}&nbsp;</div>
            <div className="teclado">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => <button key={n} onClick={() => tecla(n)}>{n}</button>)}
              <button onClick={() => (valor ? tecla('borrar') : volver())} aria-label="Borrar">⌫</button>
              <button onClick={() => tecla('0')}>0</button>
              <button className="ok" onClick={() => tecla('ok')} disabled={enviando} aria-label="Aceptar">{enviando ? '…' : '✓'}</button>
            </div>
          </>
        )}
      </div>
      <button className="boton enlace" style={{ color: '#6f84a8', marginTop: 'auto', paddingTop: 24 }}
        onClick={() => { if (confirm('¿Desactivar el kiosco en esta tableta? RH tendrá que activarla de nuevo.')) alDesactivar(); }}>
        Desactivar kiosco
      </button>
    </div>
  );
}
