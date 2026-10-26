// Las pruebas siempre corren contra la base de pruebas, nunca la de desarrollo.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://obraclara:obraclara@localhost:5432/obraclara_test';
process.env.JWT_SECRET = 'secreto-de-pruebas';
process.env.ALLOW_DEV_LOGIN = 'true';
process.env.S3_ENDPOINT = 'http://localhost:9000';
process.env.S3_BUCKET = 'obraclara-test';
process.env.S3_ACCESS_KEY_ID = 'test';
process.env.S3_SECRET_ACCESS_KEY = 'test';
