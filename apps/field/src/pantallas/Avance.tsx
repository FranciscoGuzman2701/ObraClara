import { useState } from 'react';
import { Alert, Image, ScrollView, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { ComandoSync, SnapshotObra } from '@obraclara/contracts';
import { FotoCapturada, tomarFoto } from '../fotos';
import type { SqliteOutbox } from '../sync/sqliteStore';
import { Boton, Campo, Tarjeta, Texto } from '../ui';
import { SelectorConcepto } from './SelectorConcepto';

export function Avance({ snap, outbox, alGuardar }: { snap: SnapshotObra; outbox: SqliteOutbox; alGuardar: () => void }) {
  const [conceptoId, setConceptoId] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [ubicacion, setUbicacion] = useState('');
  const [contratoLinea, setContratoLinea] = useState<string | null>(null);
  const [fotos, setFotos] = useState<FotoCapturada[]>([]);

  const concepto = snap.conceptos.find((c) => c.concepto_id === conceptoId);
  const contratos = snap.contratos.filter((c) => c.concepto_id === conceptoId);
  const n = Number(cantidad.replace(',', '.'));
  const restante = concepto ? concepto.cantidad_vigente * (1 - concepto.pct_fisico / 100) : 0;

  const foto = async () => {
    try {
      const f = await tomarFoto();
      if (f) setFotos((p) => [...p, f]);
    } catch (e) {
      Alert.alert('Cámara', (e as Error).message);
    }
  };

  const guardar = async () => {
    if (!concepto) return Alert.alert('Falta el concepto');
    if (!(n > 0)) return Alert.alert('La cantidad debe ser mayor a cero');
    if (fotos.length === 0) return Alert.alert('Sin foto no hay avance', 'Toma al menos una foto de evidencia.');
    if (n > restante + 1e-6) {
      return Alert.alert('Excede el concepto', `Sólo quedan ${restante.toFixed(2)} ${concepto.unidad} por ejecutar.`);
    }
    const comando: ComandoSync = {
      tipo: 'AVANCE_CREAR',
      client_uuid: Crypto.randomUUID(),
      obra_id: snap.obra.id,
      creado_en: new Date().toISOString(),
      payload: {
        concepto_id: concepto.concepto_id,
        cantidad: n,
        fecha: new Date().toISOString().slice(0, 10),
        ...(contratoLinea ? { contrato_linea_id: contratoLinea } : {}),
        ...(ubicacion ? { ubicacion_texto: ubicacion } : {}),
        ...(fotos[0]?.lat != null && fotos[0]?.lng != null ? { lat: fotos[0].lat, lng: fotos[0].lng } : {}),
      },
    };
    await outbox.encolar(comando, fotos.map((f) => ({ ...f, entidad_tipo: 'AVANCE' as const })));
    setConceptoId(null); setCantidad(''); setUbicacion(''); setFotos([]); setContratoLinea(null);
    alGuardar();
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Texto titulo>Reportar avance</Texto>
      {!concepto && <SelectorConcepto conceptos={snap.conceptos} valor={conceptoId} alCambiar={setConceptoId} />}
      {concepto && (
        <View>
          <Tarjeta onPress={() => setConceptoId(null)} seleccionada>
            <Texto>{concepto.clave} · {concepto.descripcion}</Texto>
            <Texto tenue>Quedan {restante.toFixed(2)} {concepto.unidad} · toca para cambiar</Texto>
          </Tarjeta>
          <Campo etiqueta={`Cantidad ejecutada (${concepto.unidad})`} keyboardType="decimal-pad" value={cantidad} onChangeText={setCantidad} />
          <Campo etiqueta="Ubicación en obra" placeholder="Ej. Nivel 2, ejes 3-5" value={ubicacion} onChangeText={setUbicacion} />
          {contratos.length > 0 && <Texto tenue>¿Quién lo ejecutó?</Texto>}
          {contratos.map((c) => (
            <Tarjeta key={c.contrato_linea_id} seleccionada={contratoLinea === c.contrato_linea_id}
              onPress={() => setContratoLinea(contratoLinea === c.contrato_linea_id ? null : c.contrato_linea_id)}>
              <Texto>{c.contratista}</Texto>
              <Texto tenue>Contrato {c.contrato_folio}</Texto>
            </Tarjeta>
          ))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 }}>
            {fotos.map((f) => <Image key={f.id} source={{ uri: f.uri }} style={{ width: 96, height: 96, borderRadius: 8 }} />)}
          </View>
          <Boton texto={fotos.length ? 'Agregar otra foto' : 'Tomar foto de evidencia'} onPress={foto} />
          <Boton texto="Guardar (se envía al tener señal)" onPress={guardar} primario />
        </View>
      )}
    </ScrollView>
  );
}
