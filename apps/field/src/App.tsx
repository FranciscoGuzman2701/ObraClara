import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, SafeAreaView, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import type { SesionUsuario, SnapshotObra } from '@obraclara/contracts';
import { SqliteOutbox } from './sync/sqliteStore';
import { sincronizar } from './sync/outbox';
import { pull, transporteHttp } from './sync/http';
import { Login } from './pantallas/Login';
import { Obras } from './pantallas/Obras';
import { Avance } from './pantallas/Avance';
import { Requisicion } from './pantallas/Requisicion';
import { Pendientes } from './pantallas/Pendientes';
import { Boton, Texto, useTema } from './ui';

type Pestana = 'avance' | 'requisicion' | 'pendientes';

export default function App() {
  const t = useTema();
  const [outbox, setOutbox] = useState<SqliteOutbox | null>(null);
  const [sesion, setSesion] = useState<SesionUsuario | null>(null);
  const [snap, setSnap] = useState<SnapshotObra | null>(null);
  const [pestana, setPestana] = useState<Pestana>('avance');
  const [version, setVersion] = useState(0);
  const [listo, setListo] = useState(false);

  // arranque: base local + sesión y obra recordadas (funciona sin señal)
  useEffect(() => {
    void (async () => {
      const db = await SqliteOutbox.abrir();
      setOutbox(db);
      const s = await SecureStore.getItemAsync('sesion');
      if (s) setSesion(JSON.parse(s));
      const obraId = await SecureStore.getItemAsync('obra');
      if (obraId) setSnap(await db.snapshot(obraId));
      setListo(true);
    })();
  }, []);

  const sync = useCallback(async () => {
    if (!outbox || !sesion) throw new Error('Sin sesión');
    const r = await sincronizar(outbox, transporteHttp(sesion.token));
    if (!r.sinConexion && snap) {
      // refresca saldos y estados con lo que el servidor ya procesó
      const nuevo = await pull(sesion.token, snap.obra.id).catch(() => null);
      if (nuevo) { await outbox.guardarSnapshot(nuevo); setSnap(nuevo); }
    }
    setVersion((v) => v + 1);
    return r;
  }, [outbox, sesion, snap]);

  // intento silencioso al volver a la app (p. ej. al recuperar señal)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void sync().catch(() => undefined); });
    return () => sub.remove();
  }, [sync]);

  const entrar = async (s: SesionUsuario) => {
    await SecureStore.setItemAsync('sesion', JSON.stringify(s));
    setSesion(s);
  };
  const elegirObra = async (obraId: string) => {
    const s = await pull(sesion!.token, obraId);
    await outbox!.guardarSnapshot(s);
    await SecureStore.setItemAsync('obra', obraId);
    setSnap(s);
  };
  const salir = async () => {
    await SecureStore.deleteItemAsync('sesion');
    await SecureStore.deleteItemAsync('obra');
    setSesion(null); setSnap(null);
  };
  const guardado = () => {
    setVersion((v) => v + 1);
    setPestana('pendientes');
    void sync().catch(() => undefined);
  };

  let contenido;
  if (!listo || !outbox) contenido = <ActivityIndicator />;
  else if (!sesion) contenido = <Login alEntrar={entrar} />;
  else if (!snap) contenido = <Obras token={sesion.token} alElegir={elegirObra} />;
  else if (pestana === 'avance') contenido = <Avance snap={snap} outbox={outbox} alGuardar={guardado} />;
  else if (pestana === 'requisicion') contenido = <Requisicion snap={snap} outbox={outbox} alGuardar={guardado} />;
  else contenido = <Pendientes obraId={snap.obra.id} outbox={outbox} sincronizar={sync} version={version} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style="auto" />
      {sesion && snap && (
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <Texto tenue>{snap.obra.clave} · {snap.obra.nombre} · {sesion.usuario.nombre}</Texto>
        </View>
      )}
      <View style={{ flex: 1, padding: 16 }}>{contenido}</View>
      {sesion && snap && (
        <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingBottom: 8 }}>
          {(['avance', 'requisicion', 'pendientes'] as const).map((p) => (
            <View key={p} style={{ flex: 1 }}>
              <Boton
                texto={{ avance: 'Avance', requisicion: 'Material', pendientes: 'Envíos' }[p]}
                onPress={() => setPestana(p)}
                primario={pestana === p}
              />
            </View>
          ))}
        </View>
      )}
      {sesion && <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}><Boton texto="Cerrar sesión" onPress={salir} /></View>}
    </SafeAreaView>
  );
}
