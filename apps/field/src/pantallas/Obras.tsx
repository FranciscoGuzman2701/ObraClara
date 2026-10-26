import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import type { ObraResumen } from '@obraclara/contracts';
import { obras as listarObras } from '../sync/http';
import { Boton, Tarjeta, Texto } from '../ui';

export function Obras({ token, alElegir }: { token: string; alElegir: (obraId: string) => Promise<void> }) {
  const [lista, setLista] = useState<ObraResumen[] | null>(null);
  const [descargando, setDescargando] = useState<string | null>(null);

  const cargar = () => listarObras(token).then(setLista).catch((e: Error) => Alert.alert('Sin conexión', e.message));
  useEffect(() => { void cargar(); }, [token]);

  const elegir = async (id: string) => {
    setDescargando(id);
    try {
      await alElegir(id); // descarga la réplica para trabajar sin señal
    } catch (e) {
      Alert.alert('No se pudo descargar la obra', (e as Error).message);
    } finally {
      setDescargando(null);
    }
  };

  return (
    <View>
      <Texto titulo>Mis obras</Texto>
      {lista === null && <Texto tenue>Cargando…</Texto>}
      {lista?.map((o) => (
        <Tarjeta key={o.id} onPress={() => elegir(o.id)}>
          <Texto>{o.clave} · {o.nombre}</Texto>
          <Texto tenue>{descargando === o.id ? 'Descargando para uso sin señal…' : o.roles.join(', ')}</Texto>
        </Tarjeta>
      ))}
      <Boton texto="Actualizar" onPress={cargar} />
    </View>
  );
}
