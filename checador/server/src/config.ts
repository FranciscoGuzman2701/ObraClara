// Configuración por variables de entorno (vea checador/.env.example).
function requerida(nombre: string): string {
  const v = process.env[nombre];
  if (!v) throw new Error(`Falta la variable de entorno ${nombre}`);
  return v;
}

export function cargarConfig() {
  const produccion = process.env.NODE_ENV === 'production';
  const jwtSecret = requerida('JWT_SECRET');
  if (produccion && jwtSecret.length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres en producción');
  return {
    puerto: Number(process.env.PORT ?? 3100),
    databaseUrl: requerida('DATABASE_URL'),
    jwtSecret,
    produccion,
    /** carpeta con la web compilada (vite build); si existe, el servidor la publica */
    webDist: process.env.WEB_DIST,
  };
}
export type Config = ReturnType<typeof cargarConfig>;
