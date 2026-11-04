import { borrar, ejecutarArchivo, migrar, SEED } from './migrar.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Defina DATABASE_URL (vea .env.example)');
  process.exit(1);
}
const cmd = process.argv[2];
if (cmd === 'reset') {
  if (process.env.NODE_ENV === 'production') throw new Error('reset no se permite en producción');
  await borrar(url);
}
if (cmd === 'migrate' || cmd === 'reset') await migrar(url);
if (cmd === 'seed' || cmd === 'reset') {
  await ejecutarArchivo(url, SEED);
  console.log('  ✔ Datos de ejemplo: grupo con P3 + 4 empresas (contraseña de todas las cuentas: demo1234)');
}
if (!['migrate', 'seed', 'reset'].includes(cmd)) {
  console.error('Uso: cli.ts migrate | seed | reset');
  process.exit(1);
}
