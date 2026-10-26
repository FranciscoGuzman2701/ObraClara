import { useState } from 'react';
import { Alert, View } from 'react-native';
import type { SesionUsuario } from '@obraclara/contracts';
import { login } from '../sync/http';
import { Boton, Texto } from '../ui';

// Login de desarrollo. En producción: OTP por teléfono.
const USUARIOS = ['cabo@demo.mx', 'residente@demo.mx'];

export function Login({ alEntrar }: { alEntrar: (s: SesionUsuario) => void }) {
  const [cargando, setCargando] = useState(false);
  const entrar = async (email: string) => {
    setCargando(true);
    try {
      alEntrar(await login(email));
    } catch (e) {
      Alert.alert('No se pudo entrar', (e as Error).message);
    } finally {
      setCargando(false);
    }
  };
  return (
    <View>
      <Texto titulo>ObraClara · Campo</Texto>
      <Texto tenue>Elige un usuario de prueba</Texto>
      {USUARIOS.map((u) => <Boton key={u} texto={u} onPress={() => entrar(u)} deshabilitado={cargando} />)}
    </View>
  );
}
