import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLastRead, setLastRead, getAllLastRead } from '$lib/server/db';

// Debug logging prefix for easy filtering in server logs
const DEBUG_PREFIX = '[LASTREAD API]';

function debugLog(...args: any[]) {
    console.log(DEBUG_PREFIX, ...args);
}

export const GET: RequestHandler = async ({ url }) => {
  const did = url.searchParams.get('did');
  const columnId = url.searchParams.get('columnId');

  debugLog('GET request:', { did: did?.substring(0, 20) + '...', columnId });

  if (!did) {
    debugLog('GET error: did required');
    return json({ error: 'did required' }, { status: 400 });
  }

  // If columnId provided, return single value; otherwise return all
  if (columnId) {
    const uri = getLastRead(did, columnId);
    debugLog('GET response (single):', { columnId, found: !!uri });
    return json({ uri });
  } else {
    const positions = getAllLastRead(did);
    debugLog('GET response (all):', { columnsCount: Object.keys(positions).length, columnIds: Object.keys(positions) });
    return json({ positions });
  }
};

export const POST: RequestHandler = async ({ request }) => {
  const { did, columnId, uri } = await request.json();

  debugLog('POST request:', { did: did?.substring(0, 20) + '...', columnId, uri: uri?.substring(0, 50) });

  if (!did || !columnId || !uri) {
    debugLog('POST error: missing required fields', { hasDid: !!did, hasColumnId: !!columnId, hasUri: !!uri });
    return json({ error: 'did, columnId, and uri required' }, { status: 400 });
  }

  setLastRead(did, columnId, uri);
  debugLog('POST success');
  return json({ success: true });
};
