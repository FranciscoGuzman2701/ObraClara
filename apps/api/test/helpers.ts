import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Storage } from '../src/archivos/storage.service';

/** Almacenamiento simulado: las pruebas deciden si el objeto "ya se subió". */
export class StorageFalso extends Storage {
  subido = false;
  async urlDeSubida(key: string) {
    return `http://storage.test/obraclara-test/${key}?X-Amz-Signature=falsa`;
  }
  async existe() {
    return this.subido;
  }
}

export const IDS = {
  obra: '00000000-0000-0000-0000-0000000000b1',
  obraAjena: '00000000-0000-0000-0000-0000000000b2',
  conceptoLosa: '00000000-0000-0000-0000-000000000401',
  lcConcreto: '00000000-0000-0000-0000-000000000501',
  lcAcero: '00000000-0000-0000-0000-000000000503',
};

export async function crearApp(storage: Storage) {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Storage).useValue(storage)
    .compile();
  const app = mod.createNestApplication({ logger: false });
  await app.init();
  return app;
}

export async function login(app: INestApplication, email: string): Promise<string> {
  const r = await request(app.getHttpServer()).post('/v1/auth/dev-login').send({ email }).expect(201);
  return r.body.token;
}

export function api(app: INestApplication, token?: string) {
  const srv = app.getHttpServer();
  const auth = (t: request.Test) => (token ? t.set('Authorization', `Bearer ${token}`) : t);
  return {
    get: (url: string) => auth(request(srv).get(url)),
    post: (url: string, body?: object) => auth(request(srv).post(url)).send(body ?? {}),
  };
}
