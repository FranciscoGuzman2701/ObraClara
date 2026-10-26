import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { calcularSemaforo, ComandoSync, SnapshotObra } from '@obraclara/contracts';
import type { SqliteOutbox } from '../sync/sqliteStore';
import { Boton, Campo, Chip, colorSemaforo, Tarjeta, Texto, useTema } from '../ui';
import { SelectorConcepto } from './SelectorConcepto';

export function Requisicion({ snap, outbox, alGuardar }: { snap: SnapshotObra; outbox: SqliteOutbox; alGuardar: () => void }) {
  const t = useTema();
  const [conceptoId, setConceptoId] = useState<string | null>(null);
  const [lineaId, setLineaId] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [justificacion, setJustificacion] = useState('');

  const concepto = snap.conceptos.find((c) => c.concepto_id === conceptoId);
  const linea = concepto?.lineas.find((l) => l.linea_control_id === lineaId);
  const n = Number(cantidad.replace(',', '.'));
  // el cabo no ve precios: la requisición viaja sin precio y Compras lo fija
  const precio = linea?.precio_vigente ?? 0;

  // semáforo preliminar con la réplica local; el servidor decide al enviar
  const sem = linea && n > 0
    ? calcularSemaforo({
        cantidad_vigente: linea.cantidad_vigente, importe_vigente: linea.importe_vigente, precio_vigente: linea.precio_vigente,
        cant_disponible: linea.cant_disponible, imp_disponible: linea.imp_disponible,
        pct_avance_fisico: concepto!.pct_fisico, cantidad: n, precio,
      }, snap.obra)
    : null;

  const guardar = async () => {
    if (!concepto || !linea) return Alert.alert('Elige concepto e insumo');
    if (!(n > 0)) return Alert.alert('La cantidad debe ser mayor a cero');
    if (sem && sem.resultado !== 'VERDE' && justificacion.trim().length < 5) {
      return Alert.alert('Justifica la solicitud', 'Está fuera de lo presupuestado; explica por qué se necesita.');
    }
    const comando: ComandoSync = {
      tipo: 'REQUISICION_CREAR',
      client_uuid: Crypto.randomUUID(),
      obra_id: snap.obra.id,
      creado_en: new Date().toISOString(),
      payload: {
        lineas: [{
          linea_control_id: linea.linea_control_id, cantidad: n, precio_estimado: precio,
          ...(justificacion.trim() ? { justificacion: justificacion.trim() } : {}),
        }],
      },
    };
    await outbox.encolar(comando, []);
    setConceptoId(null); setLineaId(null); setCantidad(''); setJustificacion('');
    alGuardar();
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Texto titulo>Pedir material</Texto>
      {!concepto && <SelectorConcepto conceptos={snap.conceptos} valor={conceptoId} alCambiar={(id) => { setConceptoId(id); setLineaId(null); }} />}
      {concepto && (
        <View>
          <Tarjeta onPress={() => setConceptoId(null)} seleccionada>
            <Texto>{concepto.clave} · {concepto.descripcion}</Texto>
            <Texto tenue>Avance físico {concepto.pct_fisico} % · toca para cambiar</Texto>
          </Tarjeta>
          <Texto tenue>Insumo</Texto>
          {concepto.lineas.filter((l) => l.insumo_tipo === 'MATERIAL' || l.insumo_tipo === 'BOLSA').map((l) => (
            <Tarjeta key={l.linea_control_id} onPress={() => setLineaId(l.linea_control_id)} seleccionada={l.linea_control_id === lineaId}>
              <Texto>{l.insumo_descripcion}</Texto>
              <Texto tenue>Disponible {l.cant_disponible.toFixed(2)} de {l.cantidad_vigente} {l.unidad}</Texto>
            </Tarjeta>
          ))}
          {linea && (
            <>
              <Campo etiqueta={`Cantidad (${linea.unidad})`} keyboardType="decimal-pad" value={cantidad} onChangeText={setCantidad} />
              {sem && (
                <View style={{ marginBottom: 12 }}>
                  <Chip texto={sem.resultado} color={colorSemaforo(t, sem.resultado)} />
                  {sem.motivos.map((m) => <Texto key={m} tenue>• {m}</Texto>)}
                  {sem.resultado === 'ROJO' && <Texto tenue>Requerirá una orden de cambio autorizada por Dirección.</Texto>}
                </View>
              )}
              {sem && sem.resultado !== 'VERDE' && (
                <Campo etiqueta="Justificación" multiline value={justificacion} onChangeText={setJustificacion} />
              )}
              <Boton texto="Guardar requisición" onPress={guardar} primario />
            </>
          )}
        </View>
      )}
    </ScrollView>
  );
}
