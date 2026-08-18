import { BehaviorSubject } from 'rxjs';
import { Workspace, FileNode, ChatMessage, AgentLog } from '../types';

const ASSEMBLY_URL = 'http://localhost:3107';
const FORUM_SLUG = 'duality-sessions';
const POLL_INTERVAL_MS = 3000;
const ENGINEER_ID = 'af069ff6-760c-44cb-a0d4-11517164169b';

/** Short per-request correlation id — attached as X-Request-Id and surfaced
 *  in user-visible error messages so a failure can be traced to assembly-srv
 *  request logs (Analyst P0-1: "Add request correlation IDs"). */
function nextCorrelationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Thrown by doEnsureThread when assembly-srv is unreachable/failing during
 *  session lookup. The visible system message was already pushed by the
 *  service; callers skip their own generic error to avoid double-reporting. */
class SessionLookupUnavailableError extends Error {}

// No-response timeout per execution backend. Harness (opencode /run-direct)
// sessions typically reply in ~15s, so a failure surfaces after 30s instead
// of forcing a full 90s wait. Freebuff interactive turns can legitimately
// take longer — keep the original 90s there. Operator (operator-svc /chat)
// is a synchronous inference call like nexus-console's messagebox; the
// subscriber allows 300s there, so the notice timer mirrors that.
const NO_RESPONSE_TIMEOUT_MS: Record<ExecutionBackend, number> = {
  operator: 300_000,
  freebuff: 90_000,
  harness: 120_000, // harness-srv now reports timeouts honestly (exit 124) — this timer is only a "slow" notice, not the failure signal
};

export type ExecutionBackend = 'operator' | 'freebuff' | 'harness';

interface AssemblyComment {
  id: string;
  body: string;
  role: string | null;
  model: string | null;
  createdAt: string;
  author: { id: string; name: string; alias: string };
}

interface AssemblyThread {
  id: string;
  title: string;
  body: string;
  comments: AssemblyComment[];
}

/** A past session thread, as listed by the session picker. */
export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  lastReplyAt: string | null;
  replyCount: number;
}

export class AssemblyBackendService {
  // Streams — same interface as SimulatedBackendService
  private architectChatSubject = new BehaviorSubject<ChatMessage[]>([]);
  public architectChat$ = this.architectChatSubject.asObservable();

  private builderLogsSubject = new BehaviorSubject<AgentLog[]>([]);
  public builderLogs$ = this.builderLogsSubject.asObservable();

  /**
   * True while a turn is in flight (user message posted, agent reply not yet
   * arrived). Drives the streaming cursor / "working" indicator in both
   * panels — the roadmap's isStreaming flag was never set in real mode.
   */
  private agentWorkingSubject = new BehaviorSubject<boolean>(false);
  public agentWorking$ = this.agentWorkingSubject.asObservable();

  // Legacy streams (kept for interface compatibility, not used for chat)
  private workspacesSubject = new BehaviorSubject<Workspace[]>([]);
  public workspaces$ = this.workspacesSubject.asObservable();
  private activeWorkspaceSubject = new BehaviorSubject<Workspace | null>(null);
  public activeWorkspace$ = this.activeWorkspaceSubject.asObservable();
  private fileTreeSubject = new BehaviorSubject<FileNode[]>([]);
  public fileTree$ = this.fileTreeSubject.asObservable();

  // Session state
  private threadId: string | null = null;
  /** Observable of the currently-loaded thread (null = none yet). */
  private currentThreadSubject = new BehaviorSubject<string | null>(null);
  public currentThreadId$ = this.currentThreadSubject.asObservable();
  private leftRole: string = 'architect';
  private rightRole: string = 'builder';
  // Execution backend for NEW sessions — 'freebuff' = interactive turn
  // (turn.requested published on NATS, session owns context); 'harness' =
  // ephemeral opencode run via harness-srv POST /run-direct.
  private executionBackend: ExecutionBackend = 'freebuff';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastCommentCount = 0;
  private isSubmitting = false;
  private watchCreated = false;
  private noResponseTimer: ReturnType<typeof setTimeout> | null = null;

  /** Configure which roles the left and right panels represent.
   *  Resets session state so ensureThread re-queries for the new role's active watch. */
  setRoles(left: string, right: string): void {
    if (this.leftRole === left && this.rightRole === right) return;
    this.leftRole = left;
    this.rightRole = right;
    // Reset so ensureThread() re-queries the server for the new role's watch
    this.threadId = null;
    this.currentThreadSubject.next(null);
    this.agentWorkingSubject.next(false);
    this.watchCreated = false;
    this.lastCommentCount = 0;
    this.sessionGen++;
    // Stop polling on the old thread + cancel any pending no-response
    // timeout so a stale 90s timer can't fire against the new role.
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.clearNoResponseTimer();
  }

  /** Choose the execution backend for NEW sessions.
   *
   *  'freebuff' → interactive turn (the Freebuff session owns context, the
   *  subscriber only emits turn.requested). 'harness' → ephemeral opencode
   *  run via harness-srv /run-direct, context reconstructed from the thread.
   *
   *  Resets session state (same semantics as setRoles) so ensureThread()
   *  starts a fresh session with the chosen backend. Existing sessions keep
   *  their original backend — the resume path only matches a watch whose
   *  execution_backend equals the current selection.
   */
  setExecutionBackend(backend: ExecutionBackend): void {
    if (this.executionBackend === backend) return;
    this.executionBackend = backend;
    this.threadId = null;
    this.currentThreadSubject.next(null);
    this.agentWorkingSubject.next(false);
    this.watchCreated = false;
    this.lastCommentCount = 0;
    this.sessionGen++;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.clearNoResponseTimer();
  }

  private ensureThreadPromise: Promise<string> | null = null;
  // Bumped on every role/backend switch; doEnsureThread discards its result
  // if superseded mid-create (prevents committing a stale session).
  private sessionGen = 0;

  /** List past duality-sessions threads (newest first) for the session picker.
   *  Throws on transport/HTTP failure so the picker can distinguish "no
   *  sessions" from "can't reach assembly-srv" (P0-1). */
  async listSessions(): Promise<SessionSummary[]> {
    const corr = nextCorrelationId();
    const resp = await fetch(`${ASSEMBLY_URL}/api/forums/${FORUM_SLUG}/threads`, {
      headers: { 'X-Request-Id': corr },
    });
    if (!resp.ok) {
      const errBody = (await resp.text().catch(() => '')) || resp.statusText;
      throw new Error(`Failed to list sessions (HTTP ${resp.status}): ${errBody.slice(0, 200)} [${corr}]`);
    }
    const data = await resp.json();
    const items = Array.isArray(data) ? data : (data.threads || data.items || []);
    return items.map((t: Record<string, unknown>) => ({
      id: String(t.id),
      title: String(t.title || 'Untitled session'),
      createdAt: String(t.createdAt || ''),
      lastReplyAt: t.lastReplyAt ? String(t.lastReplyAt) : null,
      replyCount: Number(t.replyCount || 0),
    }));
  }

  /**
   * Switch the UI to an existing session thread (session picker). Loads its
   * history, (re)activates a watch so new turns are processed, and polls it.
   */
  async loadThread(threadId: string): Promise<void> {
    this.clearNoResponseTimer();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.threadId = threadId;
    this.currentThreadSubject.next(threadId);
    this.agentWorkingSubject.next(false);
    this.watchCreated = false;
    this.lastCommentCount = 0;
    this.sessionGen++;
    await this.loadThreadHistory();
    await this.ensureWatch();
    this.startPolling();
  }

  /**
   * Start a brand-new session: forget the current thread and create a fresh
   * one for the current role/backend on the next ensureThread() call.
   */
  startNewSession(): void {
    this.clearNoResponseTimer();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.threadId = null;
    this.currentThreadSubject.next(null);
    this.agentWorkingSubject.next(false);
    this.watchCreated = false;
    this.lastCommentCount = 0;
    this.sessionGen++;
    // Fire-and-forget: the panels re-render via architectChat$ once the new
    // thread exists and its history is loaded.
    void this.ensureThread().catch(() => {});
  }

  /** Create or resume a session thread. Returns the thread ID.
   *  Public so ArchitectChat can call it on mount for immediate session load.
   *  In-flight calls are deduped so rapid role/backend switches or React
   *  StrictMode double effects cannot create duplicate empty sessions. */
  ensureThread(): Promise<string> {
    if (this.threadId) return Promise.resolve(this.threadId);
    if (this.ensureThreadPromise) return this.ensureThreadPromise;
    this.ensureThreadPromise = this.doEnsureThread().finally(() => {
      this.ensureThreadPromise = null;
    });
    return this.ensureThreadPromise;
  }

  private async doEnsureThread(): Promise<string> {
    if (this.threadId) return this.threadId;
    const gen = this.sessionGen;

    // Try server-side session lookup (survives browser clears / iframe reloads).
    // P0-1: a 5xx/timeout/network failure here must NOT fall through to
    // creating a new thread — that is how orphan duplicate sessions are born
    // (the real conversation exists server-side but the UI can't see it).
    // Only a definitive "no active watch" (200 with no threadId, or a 404)
    // legitimately proceeds to creation.
    const corr = nextCorrelationId();
    let lookupUnavailable = false;
    try {
      // Pass the selected backend so the server returns the most recent
      // session for THIS execution path (freebuff vs harness) instead of
      // the globally most recent one — the backend-blind lookup previously
      // returned the wrong session type and caused a silent new-thread
      // creation, orphaning the real conversation.
      const resp = await fetch(
        `${ASSEMBLY_URL}/api/duality/watches/active?role=${encodeURIComponent(this.leftRole)}&forumSlug=${encodeURIComponent(FORUM_SLUG)}&execution_backend=${encodeURIComponent(this.executionBackend)}`,
        { headers: { 'X-Request-Id': corr } }
      );
      if (resp.ok) {
        const data = await resp.json();
        if (data.threadId) {
          // Verify thread still exists
          const threadResp = await fetch(`${ASSEMBLY_URL}/api/forums/threads/${data.threadId}`, {
            headers: { 'X-Request-Id': corr },
          });
          if (threadResp.ok) {
            if (gen !== this.sessionGen) return ''; // superseded by a switch
            this.threadId = data.threadId;
            this.currentThreadSubject.next(data.threadId);
            // Resume regardless of watch status — a session closed by the
            // subscriber (e.g. lease-gate failure) must stay visible with its
            // error history, or the user's message looks like it vanished.
            // If the watch is not active (closed/missing), create a fresh
            // active watch so new turns on this thread are processed.
            const hasActiveWatch = await this.activeWatchMatchesBackend(data.threadId);
            if (!hasActiveWatch) {
              await this.ensureWatch();
            }
            this.startPolling();
            await this.loadThreadHistory();
            return this.threadId;
          }
          if (threadResp.status !== 404) {
            // 5xx/timeout — the thread may still exist; do NOT create a new one.
            lookupUnavailable = true;
          }
          // 404 → the old thread is really gone — proceed to create.
        }
      } else if (resp.status !== 404) {
        lookupUnavailable = true;
      }
    } catch {
      lookupUnavailable = true;
    }

    if (lookupUnavailable) {
      // assembly-srv is down or failing — creating a new thread here would
      // orphan the real conversation into a duplicate empty session. Surface
      // the transport failure visibly; the next send re-attempts the lookup.
      const sysMsg: ChatMessage = {
        id: 'err-lookup-' + Date.now(),
        role: 'system',
        content: `⚠️  Could not reach assembly-srv to resume this session — not creating a duplicate. The next message will retry. (${corr})`,
        timestamp: new Date(),
      };
      const current = this.architectChatSubject.getValue();
      this.architectChatSubject.next([...current, sysMsg]);
      this.agentWorkingSubject.next(false);
      throw new SessionLookupUnavailableError(
        `Session lookup failed — assembly-srv unreachable [${corr}]`
      );
    }

    // Create new thread — tag the title with the backend so sessions are
    // identifiable in the forum at a glance.
    const backendTag = this.executionBackend;
    const title = `Session — ${this.leftRole} + ${this.rightRole} (${backendTag}) — ${new Date().toLocaleString()}`;
    const resp = await fetch(`${ASSEMBLY_URL}/api/forums/duality-sessions/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': corr },
      body: JSON.stringify({
        title,
        body: `Interactive session: **${this.leftRole}** (left panel) ↔ **${this.rightRole}** (right panel). Backend: **${backendTag}**.`,
        postedById: ENGINEER_ID,
        role: 'system',
        model: 'freebuff/deepseek-v4-flash',
      }),
    });
    if (!resp.ok) {
      const errBody = (await resp.text().catch(() => '')) || resp.statusText;
      throw new Error(`Failed to create thread (HTTP ${resp.status}): ${errBody.slice(0, 200)} [${corr}]`);
    }
    const data = await resp.json();
    if (gen !== this.sessionGen) return ''; // superseded by a role/backend switch
    this.threadId = data.id;
    this.currentThreadSubject.next(data.id);

    // Create session watch so the subscriber knows to dispatch responses
    await this.ensureWatch();

    this.startPolling();
    return this.threadId;
  }

  /** Load existing thread history into the chat state. */
  private async loadThreadHistory(): Promise<void> {
    if (!this.threadId) return;
    try {
      const resp = await fetch(`${ASSEMBLY_URL}/api/forums/threads/${this.threadId}`, {
        headers: { 'X-Request-Id': nextCorrelationId() },
      });
      if (!resp.ok) return;
      const data: AssemblyThread = await resp.json();
      const comments = data.comments || [];
      this.lastCommentCount = comments.length;
      this.syncCommentsToState(comments);
    } catch {
      // Best-effort; polling will catch up
    }
  }

  /** Start polling the thread for new comments. */
  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.pollThread(), POLL_INTERVAL_MS);
  }

  /** Consecutive poll failures — used to surface a persistent transport
   *  failure visibly (P0-1: "polling failure: silent retry"). */
  private consecutivePollFailures = 0;

  /** Poll the current thread for new comments from agent roles. */
  private async pollThread(): Promise<void> {
    if (!this.threadId || this.isSubmitting) return;
    const corr = nextCorrelationId();
    try {
      const resp = await fetch(`${ASSEMBLY_URL}/api/forums/threads/${this.threadId}`, {
        headers: { 'X-Request-Id': corr },
      });
      if (!resp.ok) {
        this.notePollFailure(corr, `HTTP ${resp.status}`);
        return;
      }
      this.consecutivePollFailures = 0;
      const data: AssemblyThread = await resp.json();
      const comments = data.comments || [];
      if (comments.length > this.lastCommentCount) {
        this.lastCommentCount = comments.length;
        this.syncCommentsToState(comments);
      }
    } catch {
      this.notePollFailure(corr, 'network error');
    }
  }

  /** Count a poll failure; surface a visible message after the second
   *  consecutive failure (≈6s), once. The next successful poll clears it. */
  private notePollFailure(corr: string, why: string): void {
    this.consecutivePollFailures++;
    if (this.consecutivePollFailures !== 2) return;
    const sysMsg: ChatMessage = {
      id: 'err-poll-' + Date.now(),
      role: 'system',
      content: `⚠️  Connection to assembly-srv lost (${why}) — still retrying. Agent replies may be delayed. (${corr})`,
      timestamp: new Date(),
    };
    const current = this.architectChatSubject.getValue();
    this.architectChatSubject.next([...current, sysMsg]);
  }

  /** Convert Assembly comments to ChatMessage and AgentLog arrays. */
  private syncCommentsToState(comments: AssemblyComment[]): void {
    const leftMessages: ChatMessage[] = [];
    const rightLogs: AgentLog[] = [];

    for (const c of comments) {
      const role = c.role || 'user';
      const author = c.author?.alias || c.author?.name || role;
      const timestamp = new Date(c.createdAt);
      const body = c.body || '';

      // Messages from the left-panel role or user → ArchitectChat.
      // System-role comments are pipeline noise EXCEPT the subscriber's
      // failure reports ("[system] Agent X encountered an error: …") —
      // those MUST reach the user, or errors look like silent timeouts.
      if (role === this.leftRole || role === 'user') {
        leftMessages.push({
          id: c.id,
          role: role === 'user' ? 'user' : 'architect',
          content: body,
          timestamp,
        });
      } else if (role === 'thinking') {
        // The agent's reasoning trace (posted by the subscriber before the
        // response) — rendered as a collapsible "thinking" block, Freebuff
        // style. Kept out of the builder/stream panel.
        leftMessages.push({
          id: c.id,
          role: 'thinking',
          content: body,
          timestamp,
        });
      } else if (role === 'system' && this.isSystemErrorComment(body)) {
        leftMessages.push({
          id: c.id,
          role: 'system',
          content: body,
          timestamp,
        });
        // The error comment IS the response for this turn — the subscriber
        // already failed fast (e.g. lease gate). Clear the no-response
        // timer so the user doesn't get a spurious timeout notice on top,
        // and surface the failure in the stream panel as a red entry too.
        this.clearNoResponseTimer();
        this.agentWorkingSubject.next(false);
        rightLogs.push({
          id: c.id + '-err',
          agent: 'builder',
          action: 'Error',
          details: body.slice(0, 500),
          status: 'error',
          timestamp,
        });
      }

      // Messages from the right-panel role → BuilderStream
      if (role === this.rightRole) {
        rightLogs.push({
          id: c.id,
          agent: 'builder',
          action: role,
          details: body.slice(0, 500),
          status: 'success',
          timestamp,
        });
      }

      // Agent response arrived — clear the no-response timeout and the
      // in-flight working indicator (the synthetic pending log is dropped by
      // this rebuild).
      if (role === this.leftRole || role === this.rightRole) {
        this.clearNoResponseTimer();
        this.agentWorkingSubject.next(false);
      }

      // Agent-to-agent delegation: left role's message that mentions right role
      if (role === this.leftRole && body.includes(`@${this.rightRole}`)) {
        rightLogs.push({
          id: c.id + '-delegation',
          agent: 'architect',
          action: `Delegates to ${this.rightRole}`,
          details: body.slice(0, 300),
          status: 'pending',
          timestamp,
        });
      }
    }

    this.architectChatSubject.next(leftMessages);
    this.builderLogsSubject.next(rightLogs);
  }

  /** Ensure a session_watch exists for the current thread. */
  private async ensureWatch(): Promise<void> {
    if (this.watchCreated || !this.threadId) return;
    const corr = nextCorrelationId();
    try {
      const resp = await fetch(`${ASSEMBLY_URL}/api/duality/watches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': corr },
        body: JSON.stringify({
          threadId: this.threadId,
          forumSlug: FORUM_SLUG,
          role: this.leftRole,
          executionBackend: this.executionBackend,
          maxTurns: 20,
          idleTimeoutMs: 300_000,
        }),
      });
      // P0-1: a 4xx/5xx here is NOT a created watch — don't mark it as one,
      // or the subscriber silently never gets told to respond.
      if (!resp.ok) {
        const errBody = (await resp.text().catch(() => '')) || resp.statusText;
        throw new Error(`HTTP ${resp.status}: ${errBody.slice(0, 200)}`);
      }
      this.watchCreated = true;
    } catch (err) {
      console.error('[AssemblyBackend] Failed to create session watch:', err);
      // Surface as a system message so the user sees the problem
      const sysMsg: ChatMessage = {
        id: 'err-watch-' + Date.now(),
        role: 'system',
        content: `⚠️  Could not create session watch for **${this.leftRole}** — the subscriber won't know to respond. Is assembly-srv running? (${err instanceof Error ? err.message : String(err)}) [${corr}]`,
        timestamp: new Date(),
      };
      const current = this.architectChatSubject.getValue();
      this.architectChatSubject.next([...current, sysMsg]);
    }
  }

  /** True when the thread has an active watch using the selected backend.
   *
   *  Used by ensureThread() to decide whether a server-side session lookup
   *  should be resumed: a watch created with a different execution_backend
   *  (e.g. a live freebuff session) must not be reused for a harness session.
   *  On lookup failure we allow the resume (status quo behavior).
   */
  private async activeWatchMatchesBackend(threadId: string): Promise<boolean> {
    try {
      const resp = await fetch(`${ASSEMBLY_URL}/api/duality/watches/${threadId}`);
      if (!resp.ok) return true;
      const watches = await resp.json();
      return watches.some(
        (w: { status: string; execution_backend: string }) =>
          w.status === 'active' && w.execution_backend === this.executionBackend
      );
    } catch {
      return true; // network hiccup — allow resume
    }
  }

  /** True when a system comment is a subscriber failure report, not noise. */
  private isSystemErrorComment(body: string): boolean {
    const b = body.toLowerCase();
    return (
      body.startsWith('[system]') &&
      (b.includes('encountered an error') || b.includes('failed') || b.includes('error'))
    );
  }

  /** Arm a no-response timer — if no agent reply arrives within the
   *  backend's timeout (90s freebuff / 30s harness), surface an error. */
  private armNoResponseTimer(): void {
    this.clearNoResponseTimer();
    const timeoutMs = NO_RESPONSE_TIMEOUT_MS[this.executionBackend];
    this.noResponseTimer = setTimeout(() => {
      void this.surfaceTimeoutDiagnostics();
    }, timeoutMs);
  }

  /**
   * Surface a timeout with diagnostics from the server-side watch, instead
   * of a blind "no response" notice. When the subscriber already failed and
   * posted a system error comment, that error is surfaced by
   * syncCommentsToState; this fills the gap when nothing was posted.
   */
  private async surfaceTimeoutDiagnostics(): Promise<void> {
    let detail = '';
    if (this.threadId) {
      try {
        // Bound the diagnostics fetch — a hung assembly-srv must never
        // delay the timeout notice itself.
        const controller = new AbortController();
        const abort = setTimeout(() => controller.abort(), 5000);
        let resp: Response;
        try {
          resp = await fetch(`${ASSEMBLY_URL}/api/duality/watches/${this.threadId}`, {
            signal: controller.signal,
          });
        } finally {
          clearTimeout(abort);
        }
        if (resp.ok) {
          const watches: Array<{ status: string; execution_backend: string; role: string }> = await resp.json();
          const watch = watches.find(w => w.role === this.leftRole) || watches[0];
          if (watch) {
            if (watch.status === 'closed') {
              detail = `\n\nSession watch is **closed** — the subscriber finished (or errored) without posting a reply. If a red error message above shows the failure, that's the cause.`;
            } else if (watch.status === 'paused') {
              detail = `\n\nSession watch is **paused** — the subscriber is not processing this thread.`;
            } else {
              detail = `\n\nSession watch is still **active** (${watch.execution_backend} backend) — the agent may be slow, or the subscriber daemon may be stuck.`;
            }
          } else {
            detail = `\n\nNo active watch found for this thread — the subscriber is not managing it.`;
          }
        }
      } catch {
        // Diagnostics fetch failed — fall through to the generic message
      }
    }

    const timeoutSec = NO_RESPONSE_TIMEOUT_MS[this.executionBackend] / 1000;
    const sysMsg: ChatMessage = {
      id: 'err-timeout-' + Date.now(),
      role: 'system',
      content: `⏳  No response from **${this.leftRole}** within ${timeoutSec}s. The subscriber daemon may be down or the role lease may be inactive. Check \`systemctl --user status cascade-interactive-turn\`.${detail}`,
      timestamp: new Date(),
    };
    const current = this.architectChatSubject.getValue();
    this.architectChatSubject.next([...current, sysMsg]);
    // End the in-flight indicator and show the timeout as a red stream entry.
    this.agentWorkingSubject.next(false);
    this.pushStreamError(`No response from ${this.leftRole} within ${timeoutSec}s.${detail}`);
  }

  private clearNoResponseTimer(): void {
    if (this.noResponseTimer) {
      clearTimeout(this.noResponseTimer);
      this.noResponseTimer = null;
    }
  }

  /** Send a user message to the agent via Assembly. */
  async sendUserMessage(content: string): Promise<void> {
    if (!content.trim() || this.isSubmitting) return;
    this.isSubmitting = true;

    try {
      const tid = await this.ensureThread();

      // 1. Add user message locally (optimistic)
      const userMsg: ChatMessage = {
        id: 'user-' + Date.now(),
        role: 'user',
        content,
        timestamp: new Date(),
      };
      const current = this.architectChatSubject.getValue();
      this.architectChatSubject.next([...current, userMsg]);

      // 2. Post as Assembly comment — CHECK the response. A failed post
      //    (e.g. subscriber/forum down, thread closed) must reach the user
      //    immediately, not silently wait out the 90s timeout.
      const postResp = await fetch(`${ASSEMBLY_URL}/api/forums/threads/${tid}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': nextCorrelationId() },
        body: JSON.stringify({
          body: content,
          postedById: ENGINEER_ID,
          role: 'user',
          model: 'freebuff/deepseek-v4-flash',
        }),
      });
      if (!postResp.ok) {
        const errBody = (await postResp.text().catch(() => '')) || postResp.statusText;
        throw new Error(`Failed to post message (HTTP ${postResp.status}): ${errBody.slice(0, 300)}`);
      }

      // 3. Arm timeout — surface error if no response within the backend
      //    timeout (90s freebuff / 30s harness)
      this.armNoResponseTimer();

      // 4. In-flight turn indicator: the streaming cursor in the chat panel
      //    and the pending "working" card in the stream panel turn on now,
      //    and turn off when the agent's reply comment arrives (poll).
      this.agentWorkingSubject.next(true);
      const pendingLog: AgentLog = {
        id: 'pending-' + Date.now(),
        agent: this.leftRole,
        action: 'Working on your request',
        details: content.slice(0, 200),
        status: 'pending',
        timestamp: new Date(),
      };
      this.builderLogsSubject.next([...this.builderLogsSubject.getValue(), pendingLog]);

      // 5. Poll immediately for the response (frontend polling handles
      //    the case where the subscriber daemon isn't running yet)
      await this.pollThread();
    } catch (err) {
      console.error('[AssemblyBackend] sendUserMessage error:', err);
      this.agentWorkingSubject.next(false);
      // The lookup-failure path already pushed its own visible system message
      // — don't double-report it here (P0-1).
      if (err instanceof SessionLookupUnavailableError) return;
      // Surface the actual error to the user instead of a silent timeout
      const sysMsg: ChatMessage = {
        id: 'err-send-' + Date.now(),
        role: 'system',
        content: `⚠️  Failed to send message: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date(),
      };
      const current = this.architectChatSubject.getValue();
      this.architectChatSubject.next([...current, sysMsg]);
      this.pushStreamError(`Failed to send message: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.isSubmitting = false;
    }
  }

  /** Push an error entry into the stream panel (right panel). */
  private pushStreamError(details: string): void {
    const errLog: AgentLog = {
      id: 'err-log-' + Date.now(),
      agent: this.leftRole,
      action: 'Error',
      details: details.slice(0, 500),
      status: 'error',
      timestamp: new Date(),
    };
    this.builderLogsSubject.next([...this.builderLogsSubject.getValue(), errLog]);
  }

  /** Clean up polling and timers on destroy. */
  destroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.clearNoResponseTimer();
  }

  // ── Legacy workspace stubs (sidebar compatibility) ───

  setActiveWorkspace(ws: Workspace): void {
    this.activeWorkspaceSubject.next(ws);
  }
}

// Singleton — persisted on globalThis so Vite HMR re-execution of this module
// reuses the SAME instance (and the same rxjs subjects). Without this, every
// hot update of this file creates a fresh BackendService whose subjects nobody
// is subscribed to: sends still hit the DB, but the chat UI never sees them —
// messages look 'eaten'. Long-lived dev tabs hit this after any service edit.
const BACKEND_SERVICE_KEY = '__duality_backend_service__';
const backendGlobal = globalThis as unknown as {
  [BACKEND_SERVICE_KEY]?: AssemblyBackendService;
};
export const BackendService: AssemblyBackendService =
  backendGlobal[BACKEND_SERVICE_KEY] ??
  (backendGlobal[BACKEND_SERVICE_KEY] = new AssemblyBackendService());
