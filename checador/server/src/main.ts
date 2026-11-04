import path from 'node:path';
import { cargarConfig } from './config.js';
import { crearApp } from './app.js';

const config = cargarConfig();
// por omisión publica la web compilada (vite build) de checador/web/dist
config.webDist ??= path.resolve(process.cwd(), 'web/dist');
const app = await crearApp(config);
await app.listen({ port: config.puerto, host: '0.0.0.0' });
