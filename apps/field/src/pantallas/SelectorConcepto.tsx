import { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { ConceptoPresupuesto } from '@obraclara/contracts';
import { Campo, Tarjeta, Texto } from '../ui';

/** Buscador de conceptos sobre la réplica local (funciona sin señal). */
export function SelectorConcepto({ conceptos, valor, alCambiar }: {
  conceptos: ConceptoPresupuesto[]; valor: string | null; alCambiar: (id: string) => void;
}) {
  const [filtro, setFiltro] = useState('');
  const visibles = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return conceptos.filter((c) => !f || c.clave.includes(f) || c.descripcion.toLowerCase().includes(f)).slice(0, 30);
  }, [conceptos, filtro]);

  return (
    <View>
      <Campo etiqueta="Concepto" placeholder="Buscar por clave o descripción" value={filtro} onChangeText={setFiltro} />
      {visibles.map((c) => (
        <Tarjeta key={c.concepto_id} onPress={() => alCambiar(c.concepto_id)} seleccionada={c.concepto_id === valor}>
          <Texto>{c.clave} · {c.descripcion}</Texto>
          <Texto tenue>{c.cantidad_vigente} {c.unidad} · avance {c.pct_fisico} %</Texto>
        </Tarjeta>
      ))}
    </View>
  );
}
