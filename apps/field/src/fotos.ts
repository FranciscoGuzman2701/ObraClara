import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';

export interface FotoCapturada {
  id: string;
  uri: string;
  mime: 'image/jpeg';
  bytes: number;
  sha256: string;
  tomada_en: string;
  lat: number | null;
  lng: number | null;
}

/**
 * Evidencia sólo desde la cámara (no galería), comprimida, con hash SHA-256
 * del archivo y ubicación del momento de la toma.
 */
export async function tomarFoto(): Promise<FotoCapturada | null> {
  const cam = await ImagePicker.requestCameraPermissionsAsync();
  if (!cam.granted) throw new Error('Se necesita permiso de cámara para la evidencia');
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6, exif: false });
  if (r.canceled || !r.assets[0]) return null;

  const archivo = new File(r.assets[0].uri);
  const contenido = await archivo.bytes();
  const hash = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, contenido);
  const ubicacion = await ubicacionActual();
  return {
    id: Crypto.randomUUID(),
    uri: archivo.uri,
    mime: 'image/jpeg',
    bytes: contenido.byteLength,
    sha256: [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join(''),
    tomada_en: new Date().toISOString(),
    lat: ubicacion?.lat ?? null,
    lng: ubicacion?.lng ?? null,
  };
}

async function ubicacionActual(): Promise<{ lat: number; lng: number } | null> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) return null;
  // la última conocida es instantánea; la actual puede tardar sin señal
  const pos = (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 }))
    ?? (await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((ok) => setTimeout(() => ok(null), 8000)),
    ]));
  return pos ? { lat: pos.coords.latitude, lng: pos.coords.longitude } : null;
}
