export interface ProviderConfig {
  id: string;
  name: string;
  models: string[];
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
}

export interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  content?: string;
  isOpen?: boolean;
}

export type Role = 'user' | 'architect' | 'builder' | 'system' | 'thinking';

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export interface AgentLog {
  id: string;
  /** Role name of the producing agent (any tackle role). */
  agent: string;
  action: string;
  details: string;
  status: 'pending' | 'success' | 'error';
  timestamp: Date;
}
