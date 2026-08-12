import { BehaviorSubject } from 'rxjs';
import { Workspace, FileNode, ChatMessage, AgentLog } from '../types';

const ASSEMBLY_URL = 'http://localhost:3107';
const FORUM_SLUG = 'duality-sessions';
const POLL_INTERVAL_MS = 3000;
const ENGINEER_ID = 'af069ff6-760c-44cb-a0d4-11517164169b';

export type ExecutionBackend = 'freebuff' | 'harness';

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

export class AssemblyBackendService {
  // Streams — same interface as SimulatedBackendService
  private architectChatSubject = new BehaviorSubject<ChatMessage[]>([]);
  public architectChat$ = this.architectChatSubject.asObservable();

  private builderLogsSubject = new BehaviorSubject<AgentLog[]>([]);
  public builderLogs$ = this.builderLogsSubject.asObservable();

  // Legacy streams (kept for interface compatibility, not used for chat)
  private workspacesSubject = new BehaviorSubject<Workspace[]>([]);
  public workspaces$ = this.workspacesSubject.asObservable();
  private activeWorkspaceSubject = new BehaviorSubject<Workspace | null>(null);
  public activeWorkspace$ = this.activeWorkspaceSubject.asObservable();
  private fileTreeSubject = new BehaviorSubject<FileNode[]>([]);
  public fileTree$ = this.fileTreeSubject.asObservable();

  // Session state
  private threadId: string | null = null;
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

    // Try server-side session lookup (survives browser clears / iframe reloads)
    try {
      const resp = await fetch(
        `${ASSEMBLY_URL}/api/duality/watches/active?role=${encodeURIComponent(this.leftRole)}&forumSlug=${encodeURIComponent(FORUM_SLUG)}`
      );
      if (resp.ok) {
        const data = await resp.json();
        if (data.threadId) {
          // Only resume if an active watch on that thread uses the currently
          // selected backend — a freebuff session must not be hijacked into
          // a harness one (or vice versa). Otherwise fall through and create
          // a fresh session with the selected backend.
          const watchMatches = await this.activeWatchMatchesBackend(data.threadId);
          if (watchMatches) {
            // Verify thread still exists
            const threadResp = await fetch(`${ASSEMBLY_URL}/api/forums/threads/${data.threadId}`);
            if (threadResp.ok) {
              if (gen !== this.sessionGen) return ''; // superseded by a switch
              this.threadId = data.threadId;
              this.startPolling();
              await this.loadThreadHistory();
              return this.threadId;
            }
          }
        }
      }
    } catch {
      // Server lookup failed — fall through to create new thread
    }

    // Create new thread — tag the title with the backend so sessions are
    // identifiable in the forum at a glance.
    const backendTag = this.executionBackend;
    const title = `Session — ${this.leftRole} + ${this.rightRole} (${backendTag}) — ${new Date().toLocaleString()}`;
    const resp = await fetch(`${ASSEMBLY_URL}/api/forums/duality-sessions/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        body: `Interactive session: **${this.leftRole}** (left panel) ↔ **${this.rightRole}** (right panel). Backend: **${backendTag}**.`,
        postedById: ENGINEER_ID,
        role: 'system',
        model: 'freebuff/deepseek-v4-flash',
      }),
    });
    if (!resp.ok) throw new Error(`Failed to create thread: ${resp.status}`);
    const data = await resp.json();
    if (gen !== this.sessionGen) return ''; // superseded by a role/backend switch
    this.threadId = data.id;

    // Create session watch so the subscriber knows to dispatch responses
    await this.ensureWatch();

    this.startPolling();
    return this.threadId;
  }

  /** Load existing thread history into the chat state. */
  private async loadThreadHistory(): Promise<void> {
    if (!this.threadId) return;
    try {
      const resp = await fetch(`${ASSEMBLY_URL}/api/forums/threads/${this.threadId}`);
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

  /** Poll the current thread for new comments from agent roles. */
  private async pollThread(): Promise<void> {
    if (!this.threadId || this.isSubmitting) return;
    try {
      const resp = await fetch(`${ASSEMBLY_URL}/api/forums/threads/${this.threadId}`);
      if (!resp.ok) return;
      const data: AssemblyThread = await resp.json();
      const comments = data.comments || [];
      if (comments.length > this.lastCommentCount) {
        this.lastCommentCount = comments.length;
        this.syncCommentsToState(comments);
      }
    } catch {
      // Network hiccup — retry next interval
    }
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
      } else if (role === 'system' && this.isSystemErrorComment(body)) {
        leftMessages.push({
          id: c.id,
          role: 'system',
          content: body,
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

      // Agent response arrived — clear the no-response timeout
      if (role === this.leftRole || role === this.rightRole) {
        this.clearNoResponseTimer();
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
    try {
      await fetch(`${ASSEMBLY_URL}/api/duality/watches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: this.threadId,
          forumSlug: FORUM_SLUG,
          role: this.leftRole,
          executionBackend: this.executionBackend,
          maxTurns: 20,
          idleTimeoutMs: 300_000,
        }),
      });
      this.watchCreated = true;
    } catch (err) {
      console.error('[AssemblyBackend] Failed to create session watch:', err);
      // Surface as a system message so the user sees the problem
      const sysMsg: ChatMessage = {
        id: 'err-watch-' + Date.now(),
        role: 'system',
        content: `⚠️  Could not create session watch for **${this.leftRole}** — the subscriber won't know to respond. Is assembly-srv running?`,
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

  /** Arm a no-response timer — if no agent reply arrives within 90s, surface an error. */
  private armNoResponseTimer(): void {
    this.clearNoResponseTimer();
    this.noResponseTimer = setTimeout(() => {
      void this.surfaceTimeoutDiagnostics();
    }, 90_000);
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

    const sysMsg: ChatMessage = {
      id: 'err-timeout-' + Date.now(),
      role: 'system',
      content: `⏳  No response from **${this.leftRole}** within 90s. The subscriber daemon may be down or the role lease may be inactive. Check \`systemctl --user status cascade-interactive-turn\`.${detail}`,
      timestamp: new Date(),
    };
    const current = this.architectChatSubject.getValue();
    this.architectChatSubject.next([...current, sysMsg]);
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
        headers: { 'Content-Type': 'application/json' },
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

      // 3. Arm timeout — surface error if no response within 90s
      this.armNoResponseTimer();

      // 4. Poll immediately for the response (frontend polling handles
      //    the case where the subscriber daemon isn't running yet)
      await this.pollThread();
    } catch (err) {
      console.error('[AssemblyBackend] sendUserMessage error:', err);
      // Surface the actual error to the user instead of a silent timeout
      const sysMsg: ChatMessage = {
        id: 'err-send-' + Date.now(),
        role: 'system',
        content: `⚠️  Failed to send message: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date(),
      };
      const current = this.architectChatSubject.getValue();
      this.architectChatSubject.next([...current, sysMsg]);
    } finally {
      this.isSubmitting = false;
    }
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

// Singleton
export const BackendService = new AssemblyBackendService();
