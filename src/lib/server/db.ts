import { Database } from 'bun:sqlite';
import { building } from '$app/environment';
import path from 'path';

// Debug logging prefix for easy filtering in server logs
const DEBUG_PREFIX = '[LASTREAD DB]';

function debugLog(...args: any[]) {
    console.log(DEBUG_PREFIX, ...args);
}

// Don't initialize DB during build
const db = building ? null : new Database(
  path.join(process.cwd(), 'data', 'lastread.db')
);

// Initialize schema
if (db) {
  debugLog('Initializing SQLite database at', path.join(process.cwd(), 'data', 'lastread.db'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS last_read (
      did TEXT NOT NULL,
      column_id TEXT NOT NULL,
      uri TEXT NOT NULL,
      updated_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (did, column_id)
    )
  `);
  debugLog('Database schema initialized');
}

export function getLastRead(did: string, columnId: string): string | null {
  if (!db) {
    debugLog('GET - db not available (building?)');
    return null;
  }
  const row = db.prepare(
    'SELECT uri FROM last_read WHERE did = ? AND column_id = ?'
  ).get(did, columnId) as { uri: string } | undefined;
  debugLog('GET:', { did: did.substring(0, 20) + '...', columnId, found: !!row?.uri, uri: row?.uri?.substring(0, 50) });
  return row?.uri ?? null;
}

export function setLastRead(did: string, columnId: string, uri: string): void {
  if (!db) {
    debugLog('SET - db not available (building?)');
    return;
  }
  debugLog('SET:', { did: did.substring(0, 20) + '...', columnId, uri: uri.substring(0, 50) });
  db.prepare(`
    INSERT INTO last_read (did, column_id, uri, updated_at)
    VALUES (?, ?, ?, unixepoch())
    ON CONFLICT(did, column_id) DO UPDATE SET
      uri = excluded.uri,
      updated_at = excluded.updated_at
  `).run(did, columnId, uri);
  debugLog('SET complete');
}

export function getAllLastRead(did: string): Record<string, string> {
  if (!db) {
    debugLog('GET ALL - db not available (building?)');
    return {};
  }
  const rows = db.prepare(
    'SELECT column_id, uri FROM last_read WHERE did = ?'
  ).all(did) as { column_id: string; uri: string }[];
  debugLog('GET ALL:', { did: did.substring(0, 20) + '...', columnsFound: rows.length, columnIds: rows.map(r => r.column_id) });
  return Object.fromEntries(rows.map(r => [r.column_id, r.uri]));
}
