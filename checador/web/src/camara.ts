// Foto en vivo con la cámara (no se puede elegir una foto vieja de la galería).
// Se reduce a ~480 px en JPEG: unos 30–60 KB, cabe en la cola sin señal.

export async function abrirCamara(video: HTMLVideoElement, frontal = true): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar la cámara');
  let s: MediaStream;
  try {
    s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: frontal ? 'user' : 'environment', width: { ideal: 640 }, height: { ideal: 640 } }, audio: false });
  } catch {
    throw new Error('Permite el acceso a la cámara para poder checar');
  }
  video.srcObject = s;
  video.muted = true;
  video.playsInline = true;
  await video.play().catch(() => undefined);
  return s;
}

export function cerrarCamara(s: MediaStream | null) {
  s?.getTracks().forEach((t) => t.stop());
}

/** Toma la foto del cuadro actual del video. Devuelve base64 sin el prefijo data:. */
export function capturar(video: HTMLVideoElement, lado = 480, calidad = 0.6): string {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error('La cámara aún no está lista');
  const escala = Math.min(1, lado / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * escala);
  c.height = Math.round(h * escala);
  c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', calidad).split(',')[1];
}
