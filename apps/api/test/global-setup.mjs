import { migrate, recreateDatabase, runSqlFile, SEED_FILE } from '@obraclara/db';

export default async function () {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://obraclara:obraclara@localhost:5432/obraclara_test';
  await recreateDatabase(url);
  await migrate(url, { log: () => {} });
  await runSqlFile(url, SEED_FILE);
}
