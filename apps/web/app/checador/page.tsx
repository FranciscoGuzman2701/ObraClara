import Link from 'next/link';
import { ETIQUETA_CHECADA, type TableroAsistencia } from '@obraclara/contracts';
import { api, ApiError } from '@/lib/api';
import { hora } from '@/lib/formato';
import { Barra } from '../Barra';

const ESTADO = { TRABAJANDO: 'Trabajando', EN_DESCANSO: 'En descanso', SALIO: 'Salió', SIN_REGISTRO: 'Sin registro' } as const;
const INCIDENCIA = { FUERA_DE_ZONA: 'Fuera de zona', SIN_UBICACION: 'Sin ubicación', SECUENCIA: 'Fuera de secuencia' } as const;
const MODALIDAD = { LUGAR_FIJO: 'Lugar fijo', DESDE_CASA: 'Desde casa', MOVIL: 'Móvil', KIOSCO: 'Kiosco' } as const;

export default async function Checador({ searchParams }: { searchParams: Promise<{ fecha?: string }> }) {
  const { fecha } = await searchParams;
  const yo = await api<{ nombre: string }>('/v1/auth/yo');
  let t: TableroAsistencia;
  try {
    t = await api<TableroAsistencia>(`/v1/checador/tablero${fecha ? `?fecha=${encodeURIComponent(fecha)}` : ''}`);
  } catch (e) {
    return (
      <>
        <Barra usuario={yo.nombre} />
        <main><h1>Checador</h1><p className="error">{e instanceof ApiError ? e.message : 'No se pudo cargar'}</p></main>
      </>
    );
  }
  const r = t.resumen;
  return (
    <>
      <Barra usuario={yo.nombre} />
      <main>
        <h1>Así va tu equipo · {t.empresa.clave ?? t.empresa.nombre}</h1>
        <p className="sub">
          Asistencia del {t.fecha} · <Link href="/checador/periodos">Periodos y cierres</Link>
        </p>
        <form className="form-linea" method="get">
          <label>Fecha<input type="date" name="fecha" defaultValue={t.fecha} /></label>
          <button>Ver</button>
        </form>
        <div className="tarjetas">
          <div className="tarjeta"><div className="et">Trabajando</div><div className="val">{r.trabajando}</div></div>
          <div className="tarjeta"><div className="et">En descanso</div><div className="val">{r.en_descanso}</div></div>
          <div className="tarjeta"><div className="et">Ya salieron</div><div className="val">{r.salieron}</div></div>
          <div className="tarjeta"><div className="et">Sin registro</div><div className="val">{r.sin_registro}</div></div>
          <div className={`tarjeta${r.requieren_atencion ? ' atencion' : ''}`}>
            <div className="et">Requieren atención</div><div className="val">{r.requieren_atencion}</div>
          </div>
        </div>

        <h2>Equipo</h2>
        <div className="tabla-wrap">
          <table>
            <thead><tr><th>No.</th><th>Trabajador</th><th>Centro</th><th>Estado</th><th>Última checada</th><th>Modalidad</th><th>Incidencias</th></tr></thead>
            <tbody>
              {t.trabajadores.map((w) => (
                <tr key={w.trabajador_id}>
                  <td>{w.numero}</td>
                  <td>{w.nombre}</td>
                  <td>{w.centro ?? '—'}</td>
                  <td><span className={`chip ${w.estado}`}>{ESTADO[w.estado]}</span></td>
                  <td>{hora(w.ultima_checada)}</td>
                  <td>{w.modalidad ? MODALIDAD[w.modalidad] : '—'}</td>
                  <td>{w.incidencias.map((i) => <span key={i} className={`chip ${i}`}>{INCIDENCIA[i]}</span>)}</td>
                </tr>
              ))}
              {t.trabajadores.length === 0 && <tr><td colSpan={7} className="vacio">Sin trabajadores dados de alta</td></tr>}
            </tbody>
          </table>
        </div>

        <h2>Incidencias del día</h2>
        <div className="tabla-wrap">
          <table>
            <thead><tr><th>Hora</th><th>Trabajador</th><th>Checada</th><th>Qué pasó</th><th className="n">Distancia</th></tr></thead>
            <tbody>
              {t.incidencias.map((i) => (
                <tr key={i.checada_id}>
                  <td>{hora(i.ocurrido_en)}</td>
                  <td>{i.trabajador}</td>
                  <td>{ETIQUETA_CHECADA[i.tipo]}</td>
                  <td>{i.incidencias.map((x) => <span key={x} className={`chip ${x}`}>{INCIDENCIA[x]}</span>)}</td>
                  <td className="n">{i.distancia_m == null ? '—' : `${i.distancia_m.toLocaleString('es-MX')} m`}</td>
                </tr>
              ))}
              {t.incidencias.length === 0 && <tr><td colSpan={5} className="vacio">Sin incidencias</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
