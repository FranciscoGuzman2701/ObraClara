import { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import type { SqliteOutbox } from '../sync/sqliteStore';
import type { ResumenSync } from '../sync/outbox';
import { Boton, Chip, Tarjeta, Texto, useTema } from '../ui';

type Fila = Awaited<ReturnType<SqliteOutbox['historial']>>[number];

export function Pendientes({ obraId, outbox, sincronizar, version }: {
  obraId: string; outbox: SqliteOutbox; sincronizar: () => Promise<ResumenSync>; version: number;
}) {
  const t = useTema();
  const [filas, setFilas] = useState<Fila[]>([]);
  const [sincronizando, setSincronizando] = useState(false);
  const [ultimo, setUltimo] = useState<string | null>(null);

  const recargar = useCallback(() => outbox.historial(obraId).then(setFilas), [outbox, obraId]);
  useEffect(() => { void recargar(); }, [recargar, version]);

  const sync = async () => {
    setSincronizando(true);
    try {
      const r = await sincronizar();
      setUltimo(r.sinConexion
        ? 'Sin señal: se reintentará después'
        : `Enviados ${r.enviados} · rechazados ${r.rechazados} · fotos ${r.fotosSubidas}`);
    } finally {
      setSincronizando(false);
      await recargar();
    }
  };

  const color = { PENDIENTE: t.tenue, ACEPTADO: t.VERDE, DUPLICADO: t.VERDE, RECHAZADO: t.ROJO } as const;
  const pendientes = filas.filter((f) => f.estado === 'PENDIENTE' || f.fotos_pendientes > 0).length;

  return (
    <View style={{ flex: 1 }}>
      <Texto titulo>Pendientes de enviar: {pendientes}</Texto>
      {ultimo && <Texto tenue>{ultimo}</Texto>}
      <Boton texto={sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'} onPress={sync} primario deshabilitado={sincronizando} />
      <FlatList
        data={filas}
        keyExtractor={(f) => f.comando.client_uuid}
        renderItem={({ item: f }) => (
          <Tarjeta>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Texto>{f.comando.tipo === 'AVANCE_CREAR' ? 'Avance' : 'Requisición'}</Texto>
              <Chip texto={f.estado === 'DUPLICADO' ? 'ENVIADO' : f.estado === 'ACEPTADO' ? 'ENVIADO' : f.estado} color={color[f.estado]} />
            </View>
            <Texto tenue>{new Date(f.comando.creado_en).toLocaleString('es-MX')}</Texto>
            {f.fotos > 0 && <Texto tenue>Fotos: {f.fotos - f.fotos_pendientes}/{f.fotos} subidas</Texto>}
            {f.motivo && <Texto tenue>Motivo: {f.motivo}</Texto>}
          </Tarjeta>
        )}
      />
    </View>
  );
}
