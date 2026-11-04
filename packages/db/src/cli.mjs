import { spawnSync } from 'node:child_process';
import { migrate, runSqlFile, recreateDatabase, SEED_FILE, DEMO_FILE } from './index.mjs';

const [cmd] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Defina DATABASE_URL (vea .env.example)');
  process.exit(1);
}

switch (cmd) {
  case 'migrate':
    console.log('Aplicando migraciones…');
    await migrate(url);
    break;
  case 'seed':
    await runSqlFile(url, SEED_FILE);
    console.log('  ✔ Datos de desarrollo cargados (empresa demo, obra OB-01)');
    break;
  case 'demo': {
    // psql para ver los NOTICE de cada regla; la demo hace ROLLBACK al final
    const r = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', DEMO_FILE], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
  case 'test': {
    // base desechable: migraciones + demo de reglas de negocio
    const testUrl = process.env.TEST_DATABASE_URL ?? url.replace(/\/[^/]+$/, '/obraclara_db_test');
    await recreateDatabase(testUrl);
    await migrate(testUrl, { log: () => {} });
    const r = spawnSync('psql', [testUrl, '-q', '-v', 'ON_ERROR_STOP=1', '-f', DEMO_FILE], { encoding: 'utf8' });
    const notices = (r.stderr ?? '').split('\n').filter((l) => l.includes('✔')).length;
    if (r.status !== 0) {
      console.error(r.stderr);
      process.exit(1);
    }
    console.log(`  ✔ Migraciones y ${notices} verificaciones de reglas de negocio OK`);
    break;
  }
  default:
    console.error('Uso: cli.mjs migrate|seed|demo|test');
    process.exit(1);
}
