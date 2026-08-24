// SSE session event stream test — P1 items 4-5.
//
// Exercises AssemblyBackendService's replayable event-stream consumer with a
// stubbed EventSource + fetch (via Vite's SSR loader, same pattern as
// p0-1-errors.mjs). Run: node tests/sse-stream.mjs
import { createServer } from 'vite';

const server = await createServer({
  root: process.cwd(),
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
});
const mod = await server.ssrLoadModule('/src/services/AssemblyBackendService.ts');
const { AssemblyBackendService } = mod;

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

// ── stub fetch: FIFO responses ─────────────────────────────────────────
let fetchLog = [];
const responses = [];
globalThis.fetch = async (url, init = {}) => {
  fetchLog.push({ url: String(url), method: init.method || 'GET' });
  const next = responses.shift();
  if (!next) throw new Error(`Unexpected fetch: ${url} ${init.method || 'GET'}`);
  if (next.throw) throw next.throw;
  return new Response(next.body ?? '', {
    status: next.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ── stub EventSource: capture instances, dispatch frames ───────────────
class FakeEventSource {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.listeners = {};
    this.onerror = null;
    this.closed = false;
    FakeEventSource.instances.push(this);
  }
  addEventListener(name, cb) { (this.listeners[name] ||= []).push(cb); }
  dispatch(name, data) {
    for (const cb of this.listeners[name] || []) cb({ data: JSON.stringify(data) });
  }
  close() { this.closed = true; }
}
globalThis.EventSource = FakeEventSource;

// ── stub localStorage ──────────────────────────────────────────────────
const storage = {};
globalThis.localStorage = {
  getItem: k => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
};

const THREAD = '11111111-2222-3333-4444-555555555555';

// Resume path fetch sequence (see doEnsureThread):
//   watches/active → {threadId} · threads/:id verify → ok · watches/:id → []
//   POST watches → {id} · threads/:id history → {comments: []}
const primeResume = () => {
  responses.push({ body: JSON.stringify({ threadId: THREAD }) });        // watches/active
  responses.push({ body: JSON.stringify({ id: THREAD }) });              // thread verify
  responses.push({ body: JSON.stringify([]) });                          // watches/:id
  responses.push({ body: JSON.stringify({ id: 'watch-1' }) });           // POST watches
  responses.push({ body: JSON.stringify({ id: THREAD, comments: [] }) }); // history
};

{
  const svc = new AssemblyBackendService();
  let working = null;
  svc.agentWorking$.subscribe(w => { working = w; });
  let turns = [];
  svc.turnState$.subscribe(t => { turns = t ? [t] : []; });

  primeResume();
  await svc.ensureThread();

  check('EventSource opened for the thread', FakeEventSource.instances.length === 1);
  const es = FakeEventSource.instances[0];
  check('stream URL uses after=0 on first connect',
        es.url.includes(`/sessions/${THREAD}/events?after=0`), es.url);

  // turn.accepted → working + accepted envelope
  es.dispatch('turn.accepted', {
    seq: 1, eventType: 'turn.accepted', threadId: THREAD,
    turnId: 'aaaa', watchId: null,
    payload: { role: 'architect', backend: 'freebuff' },
    createdAt: '2026-08-18T00:00:00Z',
  });
  check('turn.accepted → agentWorking true', working === true, `working=${working}`);
  check('turn.accepted → turnState accepted', turns[0]?.state === 'accepted', JSON.stringify(turns[0]));
  check('turn.accepted → role from payload', turns[0]?.role === 'architect');

  // comment.created → cursor advance + poll nudge (poll fetch fires)
  const pollFetchesBefore = fetchLog.length;
  es.dispatch('comment.created', {
    seq: 2, eventType: 'comment.created', threadId: THREAD,
    turnId: null, watchId: null,
    payload: { role: 'engineer', excerpt: 'hi' },
    createdAt: '2026-08-18T00:00:01Z',
  });
  await new Promise(r => setTimeout(r, 400)); // debounce 250ms
  check('comment.created → immediate poll fired', fetchLog.length > pollFetchesBefore);

  // turn.completed → working cleared + terminal envelope
  es.dispatch('turn.completed', {
    seq: 3, eventType: 'turn.completed', threadId: THREAD,
    turnId: 'aaaa', watchId: null,
    payload: { role: 'architect', backend: 'freebuff', response_comment_id: 'cccc' },
    createdAt: '2026-08-18T00:00:02Z',
  });
  check('turn.completed → agentWorking false', working === false, `working=${working}`);
  check('turn.completed → turnState completed', turns[0]?.state === 'completed');

  // cursor persisted for resume
  check('cursor persisted to localStorage after seq=3',
        storage[`duality-sse-cursor:${THREAD}`] === '3',
        JSON.stringify(storage[`duality-sse-cursor:${THREAD}`]));

  // role switch tears the stream down
  svc.setRoles('planner', 'builder');
  check('role switch closes the EventSource', es.closed === true);

  svc.destroy();
}

{
  // Reconnect uses the persisted cursor: open a fresh service on the same
  // thread and assert after=<stored cursor>.
  FakeEventSource.instances.length = 0;
  const svc = new AssemblyBackendService();
  primeResume();
  await svc.ensureThread();
  const es = FakeEventSource.instances[0];
  check('reconnect uses persisted after-cursor', es.url.includes(`?after=3`), es.url);
  svc.destroy();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
