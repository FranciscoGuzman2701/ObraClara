import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MiDia, Modalidad, ResultadoLote, TipoChecada } from '../../../server/src/tipos';
import { api, cambiarEmpresa, mensajeDe, SinConexion } from '../api';
import { almacenNavegador, enviarCola, type ChecadaLocal } from '../cola';
import { ALERTA, BOTON, CHECADA, distancia, hora, horas, MODALIDAD, REGISTRADA, saludo, siguientes } from '../jornada';
import { puede, useSesion } from '../sesion';
import { Aviso, Chip, useAhora } from '../ui';

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
      (await api<{ resultados: ResultadoLote[] }>('/api/yo/checadas/lote', { body: { checadas } })).resultados);
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
    if (modalidad !== 'LUGAR_FIJO' && modalidad !== 'MOVIL') { setUbic(null); return; }
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
  const zonaInfo = (() => {
    if (modalidad !== 'LUGAR_FIJO') return null;
    if (ubic === 'buscando') return { clase: 'tenue', texto: 'Buscando tu ubicación…' };
    if (!ubic) return { clase: 'rojo', texto: 'Sin ubicación: activa el GPS (se registrará como incidencia)' };
    if (centro?.centro_lat == null || centro.centro_lng == null) return null;
    const d = distancia(ubic, { lat: centro.centro_lat, lng: centro.centro_lng });
    const dentro = d <= (centro.radio_m ?? 150) + Math.min(ubic.precision_m, 100);
    return dentro
      ? { clase: 'verde', texto: `✓ Dentro de la zona · ${centro.centro}` }
      : { clase: 'rojo', texto: `Estás a ${d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`} de ${centro.centro}: quedará como fuera de zona` };
  })();

  const checar = async (tipo: TipoChecada) => {
    if (!modalidad) return;
    setOcupado(true);
    setMensaje(null);
    try {
      let u: Ubicacion | null = null;
      if (modalidad !== 'DESDE_CASA') {
        u = typeof ubic === 'object' && ubic ? ubic : await pedirUbicacion();
        setUbic(u);
      }
      const nueva: ChecadaLocal = {
        client_uuid: crypto.randomUUID(), tipo, modalidad, ocurrido_en: new Date().toISOString(), estado: 'PENDIENTE',
        ...(u ?? {}),
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

          {opciones.map((op, i) => (
            <button key={op} className={`boton-checar${i > 0 ? ' secundario' : op === 'SALIDA' ? ' salida' : ''}`}
              disabled={ocupado || !modalidad} onClick={() => void checar(op)}>
              {ocupado && i === 0 ? 'Registrando…' : BOTON[op]}
            </button>
          ))}
          {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}
        </div>

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
