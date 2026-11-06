import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { MiDia, Modalidad, ResultadoLote, TipoChecada } from '../../../server/src/tipos';
import { api, cambiarEmpresa, mensajeDe, SinConexion } from '../api';
import { almacenNavegador, enviarCola, type ChecadaLocal } from '../cola';
import { abrirCamara, capturar, cerrarCamara } from '../camara';
import { ALERTA, BOTON, CHECADA, DIAS_LARGOS, diaIso, distancia, hora, horas, MODALIDAD, REGISTRADA, saludo, siguientes } from '../jornada';
import { puede, useSesion } from '../sesion';
import { Aviso, Campo, Chip, Modal, useAccion, useAhora } from '../ui';

type ModCel = Exclude<Modalidad, 'KIOSCO'>;
interface Ubicacion { lat: number; lng: number; precision_m: number }

function pedirUbicacion(): Promise<Ubicacion | null> {
  return new Promise((ok) => {
    if (!('geolocation' in navigator)) return ok(null);
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude, precision_m: Math.round(p.coords.accuracy) }),
      () => ok(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  });
}

const leerJson = <T,>(k: string): T | null => { try { return JSON.parse(localStorage.getItem(k) ?? 'null'); } catch { return null; } };

/** Pantalla del trabajador en su celular: un toque y listo, también sin señal. */
export function Checar() {
  const { info, actualizar, salir } = useSesion();
  const ahora = useAhora();
  const zona = info.empresa.zona_horaria;
  const t = info.trabajador;
  const claveDia = `checador:dia:${t?.id}`;
  const almacen = useMemo(() => almacenNavegador(`checador:cola:${info.cuenta.id}:${info.empresa.id}`), [info.cuenta.id, info.empresa.id]);

  const [dia, setDia] = useState<MiDia | null>(() => leerJson<MiDia>(claveDia));
  const [cola, setCola] = useState<ChecadaLocal[]>(() => almacen.leer());
  const mods = (t?.modalidades.filter((m) => m !== 'KIOSCO') ?? []) as ModCel[];
  const [modalidad, setModalidad] = useState<ModCel | undefined>(() => {
    const g = localStorage.getItem('checador:modalidad') as ModCel | null;
    return g && mods.includes(g) ? g : mods[0];
  });
  const [ubic, setUbic] = useState<Ubicacion | null | 'buscando'>(null);
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error' | 'info'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [enLinea, setEnLinea] = useState(navigator.onLine);
  const [selfie, setSelfie] = useState<TipoChecada | null>(null);
  const [registrandoCasa, setRegistrandoCasa] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const d = await api<MiDia>('/api/yo/dia');
      setDia(d);
      localStorage.setItem(claveDia, JSON.stringify(d));
      setEnLinea(true);
    } catch (e) {
      if (e instanceof SinConexion) setEnLinea(false);
      else setMensaje({ tipo: 'error', texto: mensajeDe(e) });
    }
  }, [claveDia]);

  const sincronizar = useCallback(async () => {
    const r = await enviarCola(almacen, async (checadas) =>
      // enviado_en: con el mismo reloj del teléfono, para que el servidor corrija si está adelantado o atrasado
      (await api<{ resultados: ResultadoLote[] }>('/api/yo/checadas/lote', {
        body: { checadas, enviado_en: new Date().toISOString() } })).resultados);
    setCola(almacen.leer());
    setEnLinea(!r.sinConexion);
    if (!r.sinConexion) await cargar();
    return r;
  }, [almacen, cargar]);

  useEffect(() => {
    void sincronizar().catch(() => undefined);
    const enLinea = () => void sincronizar().catch(() => undefined);
    window.addEventListener('online', enLinea);
    const id = setInterval(enLinea, 60_000);
    return () => { window.removeEventListener('online', enLinea); clearInterval(id); };
  }, [sincronizar]);

  // ubicación al abrir, para avisar si está fuera de la zona antes de checar
  useEffect(() => {
    if (!modalidad) { setUbic(null); return; }
    setUbic('buscando');
    void pedirUbicacion().then(setUbic);
  }, [modalidad]);

  if (!t) {
    return (
      <div className="login"><div className="login-caja">
        <h1>Sin ficha de trabajador</h1>
        <p className="tenue">Tu cuenta en {info.empresa.nombre} no está ligada a una ficha para checar. Pídelo a RH.</p>
        {puede.verEquipo(info) ? <a className="boton primario" href="#/equipo">Ir al panel</a>
          : <button className="boton" onClick={salir}>Salir</button>}
      </div></div>
    );
  }

  const pendientes = cola.filter((c) => c.estado === 'PENDIENTE');
  const rechazadas = cola.filter((c) => c.estado === 'RECHAZADA');
  const ultimaPend = pendientes.at(-1);
  const opciones: TipoChecada[] = ultimaPend ? siguientes(ultimaPend.tipo) : dia?.siguientes ?? ['ENTRADA'];
  const centro = dia?.trabajador;
  const lejos = (d: number) => (d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`);
  const zonaInfo = ((): { clase: string; texto: string; casa?: boolean } | null => {
    if (modalidad === 'MOVIL' || !modalidad) return null;
    if (ubic === 'buscando') return { clase: 'tenue', texto: 'Buscando tu ubicación…' };
    if (!ubic) return { clase: 'rojo', texto: 'Sin ubicación: activa el GPS (se registrará como incidencia)' };
    if (modalidad === 'DESDE_CASA') {
      const casa = dia?.trabajador.casa;
      if (!casa) return { clase: 'rojo', texto: 'Aún no registras tu casa: se marcará para revisión', casa: true };
      const d = distancia(ubic, casa);
      const fuera = d > casa.radio_m + Math.min(ubic.precision_m, 100);
      if (casa.estado === 'PROPUESTA') {
        return { clase: 'ambar', texto: `Tu casa está pendiente de aprobación de RH${fuera ? ` (estás a ${lejos(d)} de ella)` : ''}` };
      }
      return fuera
        ? { clase: 'rojo', texto: `Estás a ${lejos(d)} de tu casa registrada: quedará como fuera de casa`, casa: true }
        : { clase: 'verde', texto: '✓ En tu casa registrada' };
    }
    if (centro?.centro_lat == null || centro.centro_lng == null) return null;
    const d = distancia(ubic, { lat: centro.centro_lat, lng: centro.centro_lng });
    const dentro = d <= (centro.radio_m ?? 150) + Math.min(ubic.precision_m, 100);
    return dentro
      ? { clase: 'verde', texto: `✓ Dentro de la zona · ${centro.centro}` }
      : { clase: 'rojo', texto: `Estás a ${lejos(d)} de ${centro.centro}: quedará como fuera de zona` };
  })();
  const diasRemotos = dia?.trabajador.dias_remotos ?? [];
  const noEsDiaRemoto = modalidad === 'DESDE_CASA' && diasRemotos.length > 0 && !diasRemotos.includes(diaIso(zona));
  const pideFoto = !!dia?.foto_obligatoria && (modalidad === 'DESDE_CASA' || modalidad === 'MOVIL');

  const checar = async (tipo: TipoChecada, foto?: { base64: string }) => {
    if (!modalidad) return;
    if (pideFoto && !foto) { setSelfie(tipo); return; }
    setOcupado(true);
    setMensaje(null);
    try {
      let u: Ubicacion | null = null;
      u = typeof ubic === 'object' && ubic ? ubic : await pedirUbicacion();
      setUbic(u);
      const nueva: ChecadaLocal = {
        client_uuid: crypto.randomUUID(), tipo, modalidad, ocurrido_en: new Date().toISOString(), estado: 'PENDIENTE',
        ...(u ?? {}), ...(foto ? { foto } : {}),
      };
      almacen.guardar([...almacen.leer(), nueva]);
      setCola(almacen.leer());
      const r = await sincronizar();
      const quedo = almacen.leer().find((c) => c.client_uuid === nueva.client_uuid);
      if (r.sinConexion) {
        setMensaje({ tipo: 'info', texto: `${REGISTRADA[tipo]} a las ${hora(nueva.ocurrido_en, zona)} sin señal. Se enviará sola al recuperar conexión.` });
      } else if (quedo?.estado === 'RECHAZADA') {
        almacen.guardar(almacen.leer().filter((c) => c.client_uuid !== nueva.client_uuid));
        setCola(almacen.leer());
        setMensaje({ tipo: 'error', texto: quedo.motivo ?? 'No se pudo registrar' });
      } else {
        setMensaje({ tipo: 'ok', texto: `${REGISTRADA[tipo]} · ${hora(nueva.ocurrido_en, zona)}` });
      }
    } catch (e) {
      setMensaje({ tipo: 'error', texto: mensajeDe(e) });
    } finally {
      setOcupado(false);
    }
  };

  const lista = [
    ...(dia?.bitacora ?? []).filter((b) => !b.anulada).map((b) => ({ id: b.id, tipo: b.tipo, en: b.ocurrido_en, inc: b.incidencias, pend: false })),
    ...pendientes.map((p) => ({ id: p.client_uuid, tipo: p.tipo, en: p.ocurrido_en, inc: [] as string[], pend: true })),
  ];

  return (
    <div className="movil">
      <div className="movil-cab">
        <div className="fila-cab">
          <strong>{info.empresa.nombre === info.empresa.clave ? info.empresa.clave : `${info.empresa.clave} · ${info.empresa.nombre}`}</strong>
          <span style={{ fontSize: 13, color: enLinea ? '#9fe0b6' : '#ffc2bc' }}>{enLinea ? '● En línea' : '● Sin señal'}</span>
        </div>
      </div>
      <div className="movil-cuerpo">
        <div className="reloj-tarjeta">
          <div className="hola">{saludo(ahora, zona)},</div>
          <div className="nombre">{t.nombre}</div>
          {t.centro && <div className="lugar">📍 {t.centro}</div>}
          <div className="reloj-grande" aria-live="off">{hora(ahora, zona)}</div>
          {dia && <div className="tenue">Hoy llevas {horas(dia.minutos_hoy)}{dia.minutos_hoy >= 60 ? ' min' : ''}</div>}

          {mods.length > 1 && (
            <div className="segmentos" role="radiogroup" aria-label="Dónde estás">
              {mods.map((m) => (
                <button key={m} role="radio" aria-checked={m === modalidad} className={m === modalidad ? 'activo' : undefined}
                  onClick={() => { setModalidad(m); localStorage.setItem('checador:modalidad', m); }}>{MODALIDAD[m]}</button>
              ))}
            </div>
          )}
          {zonaInfo && <div className={`estado-zona ${zonaInfo.clase}`}>{zonaInfo.texto}</div>}
          {zonaInfo?.casa && <button className="boton enlace" style={{ marginTop: 6 }} onClick={() => setRegistrandoCasa(true)}>
            {dia?.trabajador.casa ? 'Cambié de casa: registrar la nueva' : 'Registrar mi casa (estando en ella)'}</button>}
          {noEsDiaRemoto && <div className="estado-zona ambar">Hoy no es tu día de home office
            ({diasRemotos.map((d) => DIAS_LARGOS[d]).join(', ')}): quedará marcado</div>}
          {pideFoto && <div className="estado-zona tenue">📷 Se tomará una foto al checar</div>}

          {opciones.map((op, i) => (
            <button key={op} className={`boton-checar${i > 0 ? ' secundario' : op === 'SALIDA' ? ' salida' : ''}`}
              disabled={ocupado || !modalidad} onClick={() => void checar(op)}>
              {ocupado && i === 0 ? 'Registrando…' : BOTON[op]}
            </button>
          ))}
          {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}
        </div>

        {selfie && <Selfie tipo={selfie} alCancelar={() => setSelfie(null)}
          alTomar={(base64) => { const tipo = selfie; setSelfie(null); void checar(tipo, { base64 }); }} />}
        {registrandoCasa && <RegistrarCasa alCerrar={(ok) => { setRegistrandoCasa(false); if (ok) void cargar(); }} />}

        {rechazadas.length > 0 && (
          <Aviso>
            {rechazadas.length === 1 ? 'Una checada guardada sin señal no se aceptó' : `${rechazadas.length} checadas guardadas sin señal no se aceptaron`}:
            {' '}{rechazadas.map((r) => `${CHECADA[r.tipo]} ${hora(r.ocurrido_en, zona)} — ${r.motivo}`).join('; ')}.
            {' '}<button className="boton enlace" onClick={() => { almacen.guardar(pendientes); setCola(almacen.leer()); }}>Entendido</button>
          </Aviso>
        )}

        <div className="caja caja-in" style={{ marginTop: 16 }}>
          <h3>Bitácora de hoy</h3>
          {lista.length === 0 ? <p className="tenue" style={{ margin: 0 }}>Aún no registras nada hoy.</p> : (
            <ul className="bitacora">
              {lista.map((b) => (
                <li key={b.id}>
                  <span className={`marca-ok${b.pend ? ' marca-pend' : ''}`} aria-hidden>{b.pend ? '…' : '✓'}</span>
                  <span className="h">{hora(b.en, zona)}</span>
                  <span className="q">{CHECADA[b.tipo]}{b.pend && <small>Pendiente de enviar</small>}</span>
                  {b.inc.map((i) => <Chip key={i} clase={i}>{ALERTA[i as keyof typeof ALERTA]}</Chip>)}
                </li>
              ))}
            </ul>
          )}
        </div>

        {info.empresas.length > 1 && (
          <div className="campo" style={{ marginTop: 16 }}>
            <span>Empresa</span>
            <select className="entrada" value={info.empresa.id}
              onChange={async (e) => { try { actualizar(await cambiarEmpresa(e.target.value)); } catch (err) { setMensaje({ tipo: 'error', texto: mensajeDe(err) }); } }}>
              {info.empresas.map((e) => <option key={e.id} value={e.id}>{e.clave} · {e.nombre}</option>)}
            </select>
          </div>
        )}
        <div className="pie-movil">
          <a href="#/mis-periodos">Mis periodos</a>
          {puede.verEquipo(info) ? <a href="#/equipo">Panel</a> : <a href="#/ajustes">Contraseña</a>}
          <button className="boton enlace" onClick={salir}>Salir</button>
        </div>
      </div>
    </div>
  );
}

/** Foto en vivo antes de checar desde casa o en movimiento. */
function Selfie({ tipo, alTomar, alCancelar }: { tipo: TipoChecada; alTomar: (base64: string) => void; alCancelar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [lista, setLista] = useState(false);
  useEffect(() => {
    let s: MediaStream | null = null;
    let vivo = true;
    abrirCamara(video.current!).then((x) => { if (vivo) { s = x; setLista(true); } else cerrarCamara(x); })
      .catch((e) => setError((e as Error).message));
    return () => { vivo = false; cerrarCamara(s); };
  }, []);
  const tomar = () => {
    try { alTomar(capturar(video.current!)); } catch (e) { setError((e as Error).message); }
  };
  return (
    <Modal titulo="Foto para checar" alCerrar={alCancelar}>
      <video ref={video} className="selfie" autoPlay muted playsInline />
      <p className="tenue" style={{ textAlign: 'center' }}>RH la verá junto a tu checada. No se guarda en tu teléfono.</p>
      <Aviso>{error}</Aviso>
      <button className="boton-checar" disabled={!lista} onClick={tomar}>Tomar foto y {BOTON[tipo].toLowerCase()}</button>
    </Modal>
  );
}

/** El trabajador propone su casa estando en ella; RH la aprueba viendo el mapa. */
function RegistrarCasa({ alCerrar }: { alCerrar: (ok: boolean) => void }) {
  const [direccion, setDireccion] = useState('');
  const [ubic, setUbic] = useState<Ubicacion | null | 'buscando'>('buscando');
  const a = useAccion();
  useEffect(() => { void pedirUbicacion().then(setUbic); }, []);
  const guardar = (e: FormEvent) => {
    e.preventDefault();
    if (!ubic || ubic === 'buscando') return;
    void a.correr(async () => {
      await api('/api/yo/casa', { body: { lat: ubic.lat, lng: ubic.lng, precision_m: ubic.precision_m, direccion } });
      alCerrar(true);
    });
  };
  return (
    <Modal titulo="Registrar mi casa" alCerrar={() => alCerrar(false)}>
      <form onSubmit={guardar}>
        <p style={{ marginTop: 0 }}>Hazlo <b>estando en tu casa</b>. Se guarda tu ubicación actual y RH la revisa antes de aprobarla.
          Mientras tanto tus checadas desde casa se marcan para revisión.</p>
        <p className={ubic && ubic !== 'buscando' && ubic.precision_m <= 150 ? 'verde' : 'tenue'}>
          {ubic === 'buscando' ? 'Buscando tu ubicación…' : !ubic ? 'No se pudo obtener tu ubicación: activa el GPS.'
            : ubic.precision_m > 150 ? `Ubicación imprecisa (±${ubic.precision_m} m): acércate a una ventana o sal al patio.`
              : `✓ Ubicación lista (±${ubic.precision_m} m)`}</p>
        <Campo etiqueta="Dirección"><input value={direccion} onChange={(e) => setDireccion(e.target.value)} required minLength={5}
          placeholder="Calle, número y colonia" /></Campo>
        <Aviso>{a.error}</Aviso>
        <div className="fila">
          <button className="boton primario" disabled={a.ocupado || !ubic || ubic === 'buscando'}>Enviar a RH</button>
          {(!ubic || (ubic !== 'buscando' && ubic.precision_m > 150)) &&
            <button type="button" className="boton" onClick={() => { setUbic('buscando'); void pedirUbicacion().then(setUbic); }}>Reintentar</button>}
        </div>
      </form>
    </Modal>
  );
}
