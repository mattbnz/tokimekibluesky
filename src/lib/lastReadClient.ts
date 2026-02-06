// Debug logging prefix for easy filtering in browser console
const DEBUG_PREFIX = '[LASTREAD CLIENT]';

function debugLog(...args: any[]) {
    console.log(DEBUG_PREFIX, ...args);
}

// Debounced writes to avoid hammering the API
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 2000;

export async function getLastReadUri(did: string, columnId: string): Promise<string | null> {
  debugLog('GET single:', { did: did.substring(0, 20) + '...', columnId });
  try {
    const res = await fetch(`/api/last-read?did=${encodeURIComponent(did)}&columnId=${encodeURIComponent(columnId)}`);
    const data = await res.json();
    debugLog('GET single response:', { columnId, found: !!data.uri, uri: data.uri?.substring(0, 50) });
    return data.uri ?? null;
  } catch (e) {
    debugLog('GET single ERROR:', { columnId, error: e });
    console.error('Failed to get last read position:', e);
    return null;
  }
}

export async function getAllLastReadPositions(did: string): Promise<Record<string, string>> {
  debugLog('GET all:', { did: did.substring(0, 20) + '...' });
  try {
    const res = await fetch(`/api/last-read?did=${encodeURIComponent(did)}`);
    const data = await res.json();
    debugLog('GET all response:', { columnsCount: Object.keys(data.positions ?? {}).length, columnIds: Object.keys(data.positions ?? {}) });
    return data.positions ?? {};
  } catch (e) {
    debugLog('GET all ERROR:', { error: e });
    console.error('Failed to get last read positions:', e);
    return {};
  }
}

export async function setLastReadUriImmediate(did: string, columnId: string, uri: string): Promise<void> {
  debugLog('SET immediate:', { columnId, uri: uri.substring(0, 50) });
  try {
    const res = await fetch('/api/last-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did, columnId, uri })
    });
    debugLog('SET immediate complete:', { columnId, status: res.status });
  } catch (e) {
    debugLog('SET immediate ERROR:', { columnId, error: e });
    console.error('Failed to save last read position:', e);
  }
}

export function setLastReadUri(did: string, columnId: string, uri: string): void {
  const key = `${did}:${columnId}`;

  // Clear any pending write for this column
  const existing = pendingWrites.get(key);
  if (existing) {
    debugLog('SET debounce - clearing previous pending write:', { columnId });
    clearTimeout(existing);
  }

  debugLog('SET queued (debounced):', { columnId, uri: uri.substring(0, 50), debounceMs: DEBOUNCE_MS });

  // Debounce the write
  pendingWrites.set(key, setTimeout(async () => {
    pendingWrites.delete(key);
    debugLog('SET executing:', { columnId, uri: uri.substring(0, 50) });
    try {
      const res = await fetch('/api/last-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did, columnId, uri })
      });
      debugLog('SET complete:', { columnId, status: res.status });
    } catch (e) {
      debugLog('SET ERROR:', { columnId, error: e });
      console.error('Failed to save last read position:', e);
    }
  }, DEBOUNCE_MS));
}
