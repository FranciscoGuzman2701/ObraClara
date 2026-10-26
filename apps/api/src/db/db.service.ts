import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, types } from 'pg';
import { CONFIG, Config } from '../config';

// numeric -> number (los montos de obra caben holgadamente en un double);
// bigint se deja como string.
types.setTypeParser(types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));

export interface Tenant {
  empresaId: string;
  usuarioId: string;
}

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(@Inject(CONFIG) config: Config) {
    this.pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  }

  /**
   * Ejecuta `fn` en una transacción con el rol de aplicación (sujeto a RLS)
   * y la empresa del usuario fijada. Todo el tráfico de negocio pasa por aquí.
   */
  async tenant<T>(t: Tenant, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE oc_app');
      await client.query(
        `SELECT set_config('oc.empresa_id', $1, true), set_config('oc.usuario_id', $2, true),
                set_config('search_path', 'oc, public', true)`,
        [t.empresaId, t.usuarioId],
      );
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Consultas previas a conocer la empresa (login). No usar para datos de negocio. */
  async sistema<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
