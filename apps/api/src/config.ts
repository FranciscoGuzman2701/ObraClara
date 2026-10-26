// Configuración leída de variables de entorno (vea .env.example en la raíz).
function requerida(nombre: string): string {
  const v = process.env[nombre];
  if (!v) throw new Error(`Falta la variable de entorno ${nombre}`);
  return v;
}

export function cargarConfig() {
  const produccion = process.env.NODE_ENV === 'production';
  return {
    port: Number(process.env.PORT ?? 3001),
    databaseUrl: requerida('DATABASE_URL'),
    jwtSecret: requerida('JWT_SECRET'),
    // el login por correo sin contraseña sólo existe fuera de producción
    allowDevLogin: !produccion && process.env.ALLOW_DEV_LOGIN === 'true',
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','),
    s3: {
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: requerida('S3_BUCKET'),
      accessKeyId: requerida('S3_ACCESS_KEY_ID'),
      secretAccessKey: requerida('S3_SECRET_ACCESS_KEY'),
    },
  };
}

export type Config = ReturnType<typeof cargarConfig>;
export const CONFIG = Symbol('CONFIG');
