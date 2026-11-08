/* Supabase connection, player identity, and live rooms.
   Needs the supabase-js UMD script on the page (window.supabase).

   Identity: each device makes a random id + secret once. The server stores
   only a SHA-256 of the secret and checks it on every submit RPC, so a
   player's rows can only be updated from the device that created them. */
import { store } from '../util.js';

/* PickEm project. The publishable key is safe in the client: anon can only
   SELECT whitelisted columns and call the submit RPCs. */
export const SUPA_URL = 'https://yeykyutsbeqjcgdxlucn.supabase.co';
export const SUPA_KEY = 'sb_publishable_SLM96UPQ3Rgrf6MTpXRZUQ_LklkFhPH';

let client;
/* Returns the shared client, or null when supabase-js did not load. */
export function getClient() {
  if (client !== undefined) return client;
  try {
    client = (window.supabase && typeof window.supabase.createClient === 'function')
      ? window.supabase.createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
      : null;
  } catch (e) { client = null; }
  return client;
}

function randHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(b => b.toString(16).padStart(2, '0')).join(''); }
function uuid4() { if (crypto.randomUUID) return crypto.randomUUID(); const h = randHex(16); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; }

export function identity() {
  let id = store.get('ss.pid', null), sec = store.get('ss.psec', null);
  if (!id || !sec) { id = uuid4(); sec = randHex(24); store.set('ss.pid', id); store.set('ss.psec', sec); }
  return { id, sec };
}

/* Stable color per player id (ghost trails, live markers). */
export function colorFor(id) { let h = 0; for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 75% 66%)`; }

/* Realtime room: presence plus named broadcast events.
   supaRoom(sb, pid, { channel, events: ['hit', 'board'] }) */
export function supaRoom(sb, pid, { channel, events = [] }) {
  const ch = sb.channel(channel, { config: { presence: { key: pid }, broadcast: { self: false } } });
  const handlers = {}, peerCbs = [];
  let state = {}, ready = false, pending = null;
  ch.on('presence', { event: 'sync' }, () => { state = ch.presenceState(); peerCbs.forEach(f => f()); });
  for (const ev of events) {
    ch.on('broadcast', { event: ev }, ({ payload }) => (handlers[ev] || []).forEach(f => f({ by: payload && payload.by, data: payload, isMe: false })));
  }
  ch.subscribe(st => { if (st === 'SUBSCRIBED') { ready = true; if (pending) ch.track(pending); } });
  return {
    presence(p) { pending = p; return ready ? ch.track(p) : Promise.resolve(); },
    peers() { return Object.entries(state).map(([k, arr]) => ({ by: k, isMe: k === pid, presence: (arr && arr[0]) || null })); },
    onPeers(f) { peerCbs.push(f); },
    on(t, f) { (handlers[t] = handlers[t] || []).push(f); },
    emit(t, data) { return ch.send({ type: 'broadcast', event: t, payload: Object.assign({}, data, { by: pid }) }); }
  };
}
