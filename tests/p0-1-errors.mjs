// P0-1 error-handling smoke test — exercises AssemblyBackendService's new
// failure paths with a stubbed fetch, via Vite's SSR loader (same pattern as
// assembly-ui's tests). Run: node tests/p0-1-errors.mjs
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

// ── stub fetch: queue of responses ─────────────────────────────────────────
let fetchLog = [];
const responses = [];
globalThis.fetch = async (url, init = {}) => {
  fetchLog.push({ url: String(url), method: init.method || 'GET', headers: init.headers ?? {} });
  const next = responses.shift();
  if (!next) throw new Error(`Unexpected fetch: ${url} ${init.method || 'GET'}`);
  if (next.throw) throw next.throw;
  return new Response(next.body ?? '', {
    status: next.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const fresh = () => {
  const svc = new AssemblyBackendService();
  // Capture the observable stream into an array for assertions.
  svc._msgs = [];
  svc.architectChat$.subscribe(m => { svc._msgs = m; });
  return svc;
};

// ── 1. listSessions: HTTP 500 → throws (not silent []) ────────────────────
{
  const svc = fresh();
  responses.push({ status: 500, body: 'boom' });
  let threw = false;
  try { await svc.listSessions(); } catch { threw = true; }
  check('listSessions throws on HTTP 500', threw);
  check('listSessions sends X-Request-Id header', !!fetchLog[0].headers['X-Request-Id']);
}
fetchLog = [];

// ── 2. listSessions: network error → throws ───────────────────────────────
{
  const svc = fresh();
  responses.push({ throw: new TypeError('network down') });
  let threw = false;
  try { await svc.listSessions(); } catch { threw = true; }
  check('listSessions throws on network error', threw);
}
fetchLog = [];

// ── 3. doEnsureThread: 5xx on active-watch lookup → NO new thread created ─
{
  const svc = fresh();
  responses.push({ status: 500, body: 'oops' });
  let threw = false;
  try { await svc.ensureThread(); } catch { threw = true; }
  const createdNew = fetchLog.some(f => f.method === 'POST' && f.url.includes('/threads'));
  check('ensureThread throws SessionLookupUnavailableError on lookup 5xx', threw);
  check('NO new thread created after lookup 5xx', !createdNew);
  check('lookup failure surfaced as visible system message', svc._msgs.some(m => m.role === 'system' && m.content.includes('not creating a duplicate')));
}
fetchLog = [];

// ── 4. doEnsureThread: thread-verify 5xx → NO new thread created ─────────
{
  const svc = fresh();
  responses.push({ status: 200, body: JSON.stringify({ threadId: 't-abc' }) }); // active watch lookup
  responses.push({ status: 500, body: 'boom' });                                // thread verify
  let threw = false;
  try { await svc.ensureThread(); } catch { threw = true; }
  const createdNew = fetchLog.some(f => f.method === 'POST' && f.url.includes('/threads'));
  check('ensureThread throws when thread-verify 5xx', threw);
  check('NO new thread created after thread-verify 5xx', !createdNew);
}
fetchLog = [];

// ── 5. doEnsureThread: 404 on lookup → new thread IS created (legit) ──────
{
  const svc = fresh();
  responses.push({ status: 404, body: '' });                                     // active watch lookup: no watch
  responses.push({ status: 201, body: JSON.stringify({ id: 't-new' }) });       // create thread
  responses.push({ status: 201, body: JSON.stringify({ id: 'w-1' }) });         // create watch
  const tid = await svc.ensureThread();
  check('404 on lookup → new thread created', tid === 't-new');
}
fetchLog = [];

// ── 6. ensureWatch: HTTP 500 → watchCreated stays false + visible error ───
{
  const svc = fresh();
  responses.push({ status: 200, body: JSON.stringify({ threadId: 't-x' }) });
  responses.push({ status: 200, body: JSON.stringify({ comments: [] }) }); // thread verify OK
  responses.push({ status: 200, body: JSON.stringify([]) });                // activeWatchMatchesBackend: no active watch
  responses.push({ status: 500, body: 'boom' });                            // watch create fails
  await svc.ensureThread();
  const msgs = svc._msgs;
  check('ensureWatch 500 → visible system message', msgs.some(m => m.role === 'system' && m.content.includes('session watch')));
}
fetchLog = [];

// ── 7. sendUserMessage: lookup failure → exactly ONE system message ───────
{
  const svc = fresh();
  responses.push({ status: 500, body: 'oops' }); // lookup fails
  await svc.sendUserMessage('hello');
  const sys = svc._msgs.filter(m => m.role === 'system');
  check('sendUserMessage lookup failure → no duplicate system messages', sys.length === 1, `got ${sys.length}`);
}
fetchLog = [];

// ── 8. poll failure streak: 2 consecutive failures → visible message ──────
{
  const svc = fresh();
  responses.push({ status: 200, body: JSON.stringify({ threadId: 't-poll' }) });
  responses.push({ status: 200, body: JSON.stringify({ comments: [] }) }); // verify
  responses.push({ status: 200, body: JSON.stringify([]) });                // activeWatchMatchesBackend: no active watch
  responses.push({ status: 201, body: JSON.stringify({ id: 'w-2' }) });    // watch create
  responses.push({ status: 200, body: JSON.stringify({ comments: [] }) }); // history
  await svc.ensureThread();
  fetchLog = [];
  // pollThread is private — drive it through the internal interval by
  // waiting one poll cycle (3s) with failing responses queued. To keep the
  // test fast, call the private method via bracket access (TypeScript
  // private is a compile-time concept).
  responses.push({ status: 503, body: '' });
  responses.push({ status: 503, body: '' });
  await svc.pollThread();
  await svc.pollThread();
  const anyMsg = svc._msgs.some(m => m.role === 'system' && m.content.toLowerCase().includes('connection to assembly-srv lost'));
  check('poll streak surfaced (2 consecutive failures → visible message)', anyMsg);
  // recovery: a successful poll clears the streak and no further messages
  const before = svc._msgs.length;
  responses.push({ status: 200, body: JSON.stringify({ comments: [] }) });
  await svc.pollThread();
  check('poll recovery: no additional system messages', svc._msgs.length === before);
}
fetchLog = [];

console.log(`\n${pass} passed, ${fail} failed`);
await server.close();
process.exit(fail ? 1 : 0);
