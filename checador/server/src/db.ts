import pg from 'pg';

// numeric → number (horas, distancias, coordenadas); date se deja como texto 'YYYY-MM-DD'
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export type Cliente = pg.PoolClient;

export interface Contexto {
  empresaId: string;
  /** cuenta que actúa (null cuando actúa un kiosco) */
  cuentaId: string | null;
}

export class Db {
  readonly pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 10 });
  }

  /**
   * Transacción con el rol de aplicación (sujeto a RLS) y la empresa fijada.
   * Todo el tráfico de negocio pasa por aquí: aunque una consulta olvide filtrar
   * por empresa, PostgreSQL no devuelve filas de otra.
   */
  async empresa<T>(ctx: Contexto, fn: (c: Cliente) => Promise<T>): Promise<T> {
    return this.tx(async (c) => {
      await c.query('SET LOCAL ROLE checador_app');
      await c.query(
        `SELECT set_config('app.empresa_id', $1, true), set_config('app.cuenta_id', $2, true),
                set_config('search_path', 'checador, public', true)`,
        [ctx.empresaId, ctx.cuentaId ?? ''],
      );
      return fn(c);
    });
  }

  /** Antes de saber la empresa (login, cuentas, kiosco por token). Nunca para datos de negocio. */
  async sistema<T>(fn: (c: Cliente) => Promise<T>): Promise<T> {
    return this.tx(async (c) => {
      await c.query(`SELECT set_config('search_path', 'checador, public', true)`);
      return fn(c);
    });
  }

  private async tx<T>(fn: (c: Cliente) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }

  cerrar() {
    return this.pool.end();
  }
}
