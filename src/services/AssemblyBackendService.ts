import { BehaviorSubject } from 'rxjs';
import { Workspace, FileNode, ChatMessage, AgentLog } from '../types';

const ASSEMBLY_URL = 'http://localhost:3107';
const FORUM_SLUG = 'duality-sessions';
const POLL_INTERVAL_MS = 3000;
const ENGINEER_ID = 'af069ff6-760c-44cb-a0d4-11517164169b';

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
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastCommentCount = 0;
  private isSubmitting = false;
  private watchCreated = false;
  private noResponseTimer: ReturnType<typeof setTimeout> | null = null;

  /** Configure which roles the left and right panels represent. */
  setRoles(left: string, right: string): void {
    this.leftRole = left;
    this.rightRole = right;
  }

  /** Create or resume a session thread. Returns the thread ID. */
  private async ensureThread(): Promise<string> {
    if (this.threadId) return this.threadId;

    // Try to resume from localStorage
    const saved = localStorage.getItem('duality-thread-id');
    if (saved) {
      try {
        const resp = await fetch(`${ASSEMBLY_URL}/api/forums/threads/${saved}`);
        if (resp.ok) {
          this.threadId = saved;
          this.startPolling();
          await this.loadThreadHistory();
          return this.threadId;
        }
      } catch {
        localStorage.removeItem('duality-thread-id');
      }
    }

    // Create new thread
    const title = `Session — ${this.leftRole} + ${this.rightRole} — ${new Date().toLocaleString()}`;
    const resp = await fetch(`${ASSEMBLY_URL}/api/forums/duality-sessions/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        body: `Interactive session: **${this.leftRole}** (left panel) ↔ **${this.rightRole}** (right panel).`,
        postedById: ENGINEER_ID,
        role: 'system',
        model: 'freebuff/deepseek-v4-flash',
      }),
    });
    if (!resp.ok) throw new Error(`Failed to create thread: ${resp.status}`);
    const data = await resp.json();
    this.threadId = data.id;
    localStorage.setItem('duality-thread-id', this.threadId);

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

      // Messages from the left-panel role or user → ArchitectChat
      if (role === this.leftRole || role === 'user' || role === 'system') {
        leftMessages.push({
          id: c.id,
          role: role === 'user' ? 'user' : 'architect',
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
          executionBackend: 'freebuff',
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

  /** Arm a no-response timer — if no agent reply arrives within 90s, surface an error. */
  private armNoResponseTimer(): void {
    this.clearNoResponseTimer();
    this.noResponseTimer = setTimeout(() => {
      const sysMsg: ChatMessage = {
        id: 'err-timeout-' + Date.now(),
        role: 'system',
        content: `⏳  No response from **${this.leftRole}** within 90s. The subscriber daemon may be down or the role lease may be inactive. Check \`systemctl --user status cascade-interactive-turn\`.`,
        timestamp: new Date(),
      };
      const current = this.architectChatSubject.getValue();
      this.architectChatSubject.next([...current, sysMsg]);
    }, 90_000);
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

      // 2. Post as Assembly comment
      await fetch(`${ASSEMBLY_URL}/api/forums/threads/${tid}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: content,
          postedById: ENGINEER_ID,
          role: 'user',
          model: 'freebuff/deepseek-v4-flash',
        }),
      });

      // 3. Arm timeout — surface error if no response within 90s
      this.armNoResponseTimer();

      // 4. Poll immediately for the response (frontend polling handles
      //    the case where the subscriber daemon isn't running yet)
      await this.pollThread();
    } catch (err) {
      console.error('[AssemblyBackend] sendUserMessage error:', err);
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
