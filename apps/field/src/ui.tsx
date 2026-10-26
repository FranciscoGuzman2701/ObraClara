import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, TextInputProps, useColorScheme, View } from 'react-native';
import type { Semaforo } from '@obraclara/contracts';

const CLARO = { bg: '#f6f7f9', panel: '#ffffff', texto: '#1b1f24', tenue: '#5f6b7a', borde: '#e2e6eb', acento: '#1f5fbf',
  VERDE: '#1e8e4a', AMARILLO: '#b7791f', ROJO: '#c53030' };
const OSCURO = { bg: '#111418', panel: '#1a1e24', texto: '#e7eaee', tenue: '#9aa5b1', borde: '#2c323a', acento: '#6ea8ff',
  VERDE: '#48bb78', AMARILLO: '#ecc94b', ROJO: '#fc8181' };

export type Tema = typeof CLARO;
export const useTema = (): Tema => (useColorScheme() === 'dark' ? OSCURO : CLARO);

export function Boton({ texto, onPress, primario, deshabilitado }: {
  texto: string; onPress: () => void; primario?: boolean; deshabilitado?: boolean;
}) {
  const t = useTema();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={deshabilitado}
      onPress={onPress}
      style={({ pressed }) => [
        s.boton,
        { borderColor: primario ? t.acento : t.borde, backgroundColor: primario ? t.acento : t.panel },
        (pressed || deshabilitado) && { opacity: 0.6 },
      ]}
    >
      <Text style={{ color: primario ? '#fff' : t.texto, fontWeight: '600', fontSize: 16 }}>{texto}</Text>
    </Pressable>
  );
}

export function Campo(props: TextInputProps & { etiqueta: string }) {
  const t = useTema();
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: t.tenue, marginBottom: 4 }}>{props.etiqueta}</Text>
      <TextInput
        placeholderTextColor={t.tenue}
        {...props}
        style={[s.input, { borderColor: t.borde, color: t.texto, backgroundColor: t.panel }]}
      />
    </View>
  );
}

export function Tarjeta({ children, onPress, seleccionada }: { children: ReactNode; onPress?: () => void; seleccionada?: boolean }) {
  const t = useTema();
  return (
    <Pressable
      onPress={onPress}
      style={[s.tarjeta, { backgroundColor: t.panel, borderColor: seleccionada ? t.acento : t.borde, borderWidth: seleccionada ? 2 : 1 }]}
    >
      {children}
    </Pressable>
  );
}

export function Chip({ texto, color }: { texto: string; color: string }) {
  return (
    <View style={[s.chip, { borderColor: color }]}>
      <Text style={{ color, fontWeight: '700', fontSize: 12 }}>{texto}</Text>
    </View>
  );
}

export const colorSemaforo = (t: Tema, sem: Semaforo) => t[sem];

export function Texto({ children, tenue, titulo }: { children: ReactNode; tenue?: boolean; titulo?: boolean }) {
  const t = useTema();
  return (
    <Text style={{ color: tenue ? t.tenue : t.texto, fontSize: titulo ? 20 : 15, fontWeight: titulo ? '700' : '400', marginBottom: titulo ? 8 : 2 }}>
      {children}
    </Text>
  );
}

const s = StyleSheet.create({
  boton: { borderWidth: 1, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginVertical: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  tarjeta: { borderRadius: 12, padding: 14, marginBottom: 10 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
});
