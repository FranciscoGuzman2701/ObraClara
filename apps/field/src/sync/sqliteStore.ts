import * as SQLite from 'expo-sqlite';
import type { ComandoSync, SnapshotObra } from '@obraclara/contracts';
import type { ComandoLocal, FotoLocal, OutboxStore } from './outbox';

type Fila = Record<string, string | number | null>;

/** Bandeja de salida y réplica de lectura persistidas en SQLite del teléfono. */
export class SqliteOutbox implements OutboxStore {
  private constructor(private readonly db: SQLite.SQLiteDatabase) {}

  static async abrir(nombre = 'obraclara.db'): Promise<SqliteOutbox> {
    const db = await SQLite.openDatabaseAsync(nombre);
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS comandos (
        client_uuid TEXT PRIMARY KEY, obra_id TEXT NOT NULL, tipo TEXT NOT NULL, json TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'PENDIENTE', id_servidor TEXT, motivo TEXT,
        intentos INTEGER NOT NULL DEFAULT 0, creado_en TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fotos (
        id TEXT PRIMARY KEY, comando_uuid TEXT NOT NULL REFERENCES comandos(client_uuid),
        entidad_tipo TEXT NOT NULL, uri TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL, tomada_en TEXT NOT NULL, lat REAL, lng REAL,
        estado TEXT NOT NULL DEFAULT 'PENDIENTE', error TEXT, intentos INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS snapshots (obra_id TEXT PRIMARY KEY, json TEXT NOT NULL, descargado_en TEXT NOT NULL);
    `);
    return new SqliteOutbox(db);
  }

  /** Guarda el comando y sus fotos de forma atómica: o queda todo o nada. */
  async encolar(comando: ComandoSync, fotos: Omit<FotoLocal, 'comando_uuid' | 'estado' | 'error' | 'intentos'>[]) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(
        'INSERT INTO comandos(client_uuid, obra_id, tipo, json, creado_en) VALUES (?, ?, ?, ?, ?)',
        comando.client_uuid, comando.obra_id, comando.tipo, JSON.stringify(comando), comando.creado_en);
      for (const f of fotos) {
        await tx.runAsync(
          `INSERT INTO fotos(id, comando_uuid, entidad_tipo, uri, mime, bytes, sha256, tomada_en, lat, lng)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          f.id, comando.client_uuid, f.entidad_tipo, f.uri, f.mime, f.bytes, f.sha256, f.tomada_en, f.lat, f.lng);
      }
    });
  }

  async comandosPendientes(): Promise<ComandoLocal[]> {
    const filas = await this.db.getAllAsync<Fila>("SELECT * FROM comandos WHERE estado = 'PENDIENTE' ORDER BY creado_en");
    return filas.map(aComando);
  }

  async comando(clientUuid: string): Promise<ComandoLocal | null> {
    const f = await this.db.getFirstAsync<Fila>('SELECT * FROM comandos WHERE client_uuid = ?', clientUuid);
    return f ? aComando(f) : null;
  }

  async actualizarComando(clientUuid: string, c: Partial<Omit<ComandoLocal, 'comando'>>) {
    await this.db.runAsync(
      `UPDATE comandos SET estado = COALESCE(?, estado), id_servidor = COALESCE(?, id_servidor),
              motivo = COALESCE(?, motivo), intentos = COALESCE(?, intentos) WHERE client_uuid = ?`,
      c.estado ?? null, c.id_servidor ?? null, c.motivo ?? null, c.intentos ?? null, clientUuid);
  }

  async fotosPendientes(): Promise<FotoLocal[]> {
    return (await this.db.getAllAsync<Fila>("SELECT * FROM fotos WHERE estado = 'PENDIENTE'")) as unknown as FotoLocal[];
  }

  async actualizarFoto(id: string, c: Partial<Pick<FotoLocal, 'estado' | 'error' | 'intentos'>>) {
    await this.db.runAsync(
      `UPDATE fotos SET estado = COALESCE(?, estado), error = ?, intentos = COALESCE(?, intentos) WHERE id = ?`,
      c.estado ?? null, c.error ?? null, c.intentos ?? null, id);
  }

  /** Para la pantalla de pendientes: lo más reciente primero, con conteo de fotos. */
  async historial(obraId: string, limite = 100) {
    const filas = await this.db.getAllAsync<Fila>(
      `SELECT c.*, (SELECT count(*) FROM fotos f WHERE f.comando_uuid = c.client_uuid) AS fotos,
              (SELECT count(*) FROM fotos f WHERE f.comando_uuid = c.client_uuid AND f.estado = 'PENDIENTE') AS fotos_pendientes
         FROM comandos c WHERE obra_id = ? ORDER BY creado_en DESC LIMIT ?`, obraId, limite);
    return filas.map((f) => ({ ...aComando(f), fotos: Number(f.fotos), fotos_pendientes: Number(f.fotos_pendientes) }));
  }

  async guardarSnapshot(s: SnapshotObra) {
    await this.db.runAsync(
      'INSERT OR REPLACE INTO snapshots(obra_id, json, descargado_en) VALUES (?, ?, ?)',
      s.obra.id, JSON.stringify(s), s.generado_en);
  }

  async snapshot(obraId: string): Promise<SnapshotObra | null> {
    const f = await this.db.getFirstAsync<{ json: string }>('SELECT json FROM snapshots WHERE obra_id = ?', obraId);
    return f ? (JSON.parse(f.json) as SnapshotObra) : null;
  }
}

function aComando(f: Fila): ComandoLocal {
  return {
    comando: JSON.parse(String(f.json)) as ComandoSync,
    estado: f.estado as ComandoLocal['estado'],
    id_servidor: (f.id_servidor as string) ?? null,
    motivo: (f.motivo as string) ?? null,
    intentos: Number(f.intentos),
  };
}
