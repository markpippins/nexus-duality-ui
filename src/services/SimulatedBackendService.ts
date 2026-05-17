import { BehaviorSubject, Subject, delay, of, tap } from 'rxjs';
import { Workspace, FileNode, ChatMessage, AgentLog, ProviderConfig } from '../types';

// Initial Mock Data
const MOCK_WORKSPACES: Workspace[] = [
  { id: 'w1', name: 'OpenCode-Clone', description: 'React IDE implementation' },
  { id: 'w2', name: 'E-commerce API', description: 'Node.js backend' },
];

const INITIAL_FILE_TREE: FileNode[] = [
  {
    id: 'root', name: 'OpenCode-Clone', type: 'folder', children: [
      { id: 'src', name: 'src', type: 'folder', children: [
        { id: 'f1', name: 'App.tsx', type: 'file' },
        { id: 'f2', name: 'main.tsx', type: 'file' }
      ]},
      { id: 'pkg', name: 'package.json', type: 'file' }
    ]
  }
];

export const AVAILABLE_PROVIDERS: ProviderConfig[] = [
  { id: 'oai', name: 'OpenAI', models: ['gpt-4-turbo', 'gpt-4o', 'gpt-3.5-turbo'] },
  { id: 'ath', name: 'Anthropic', models: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'] },
  { id: 'gem', name: 'Google Gemini', models: ['gemini-1.5-pro', 'gemini-1.5-flash'] }
];

export class SimulatedBackendService {
  // Streams
  private workspacesSubject = new BehaviorSubject<Workspace[]>(MOCK_WORKSPACES);
  public workspaces$ = this.workspacesSubject.asObservable();

  private activeWorkspaceSubject = new BehaviorSubject<Workspace | null>(MOCK_WORKSPACES[0]);
  public activeWorkspace$ = this.activeWorkspaceSubject.asObservable();

  private fileTreeSubject = new BehaviorSubject<FileNode[]>(INITIAL_FILE_TREE);
  public fileTree$ = this.fileTreeSubject.asObservable();

  private architectChatSubject = new BehaviorSubject<ChatMessage[]>([
    { id: 'init', role: 'architect', content: 'Hello! I am your Architect API. What are we building today?', timestamp: new Date() }
  ]);
  public architectChat$ = this.architectChatSubject.asObservable();

  private builderLogsSubject = new BehaviorSubject<AgentLog[]>([]);
  public builderLogs$ = this.builderLogsSubject.asObservable();

  public terminalOutput$ = new Subject<string>();

  // Methods
  public setActiveWorkspace(ws: Workspace) {
    this.activeWorkspaceSubject.next(ws);
    this.terminalOutput$.next(`\\r\\n\\x1b[32mSwitching to workspace: ${ws.name}\\x1b[0m\\r\\n`);
  }

  public sendUserMessage(content: string) {
    // 1. Add user message
    const msgs = this.architectChatSubject.getValue();
    this.architectChatSubject.next([
      ...msgs, 
      { id: Date.now().toString(), role: 'user', content, timestamp: new Date() }
    ]);

    // 2. Simulate Architect Thinking -> Streaming Reply
    setTimeout(() => {
      this.simulateArchitectResponse(content);
    }, 500);
  }

  private simulateArchitectResponse(userMsg: string) {
    const responseId = 'arch-' + Date.now();
    let currentContent = '';
    
    // Add pending message
    this.architectChatSubject.next([
      ...this.architectChatSubject.getValue(),
      { id: responseId, role: 'architect', content: '', timestamp: new Date(), isStreaming: true }
    ]);

    const mockArchitectScript = `I will construct an execution plan for: "${userMsg}". Delegating to the Builder Agent now.`;
    
    let i = 0;
    const interval = setInterval(() => {
      currentContent += mockArchitectScript.charAt(i);
      
      const msgs = this.architectChatSubject.getValue();
      const idx = msgs.findIndex(m => m.id === responseId);
      if (idx !== -1) {
        msgs[idx].content = currentContent;
        this.architectChatSubject.next([...msgs]);
      }
      
      i++;
      if (i >= mockArchitectScript.length) {
        clearInterval(interval);
        // Turn off streaming flag
        const finalMsgs = this.architectChatSubject.getValue();
        if (finalMsgs[idx]) finalMsgs[idx].isStreaming = false;
        this.architectChatSubject.next([...finalMsgs]);

        // Trigger builder
        this.simulateBuilderExecution();
      }
    }, 30);
  }

  private simulateBuilderExecution() {
    this.addBuilderLog('architect', 'Parsing architect instructions...', 'pending');
    
    setTimeout(() => {
      this.addBuilderLog('architect', 'Instructions parsed. Forwarding to Builder Queue.', 'success');
      this.terminalOutput$.next('\\r\\n\\x1b[36m[Architect]\\x1b[0m Handing off to Builder.\\r\\n');
      
      setTimeout(() => {
        this.addBuilderLog('builder', 'Receiving build manifest.', 'pending');
        
        setTimeout(() => {
           this.addBuilderLog('builder', 'Generating mock component...', 'success');
           this.terminalOutput$.next('\\x1b[33m[Builder]\\x1b[0m Generating new files...\\r\\n');
           
           // File tree update simulation
           const tree = [...this.fileTreeSubject.getValue()];
           if (tree[0] && tree[0].children && tree[0].children[0]) {
             tree[0].children[0].children?.push({
               id: 'new-' + Date.now(),
               name: 'NewComponent.tsx',
               type: 'file'
             });
             this.fileTreeSubject.next(tree);
           }
           
           this.addBuilderLog('builder', 'File created: src/NewComponent.tsx', 'success');
           this.terminalOutput$.next('\\x1b[32m[Builder] Build sequence complete.\\x1b[0m\\r\\n$ ');

        }, 1500);
      }, 1000);
    }, 1000);
  }

  private addBuilderLog(agent: 'architect'|'builder', details: string, status: 'pending'|'success'|'error') {
    this.builderLogsSubject.next([
      ...this.builderLogsSubject.getValue(),
      { id: Date.now().toString() + Math.random(), agent, action: 'Execute', details, status, timestamp: new Date() }
    ]);
  }
}

// Singleton instances for injectable-like behavior
export const BackendService = new SimulatedBackendService();
