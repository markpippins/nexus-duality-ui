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

export type Role = 'user' | 'architect' | 'builder' | 'system';

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export interface AgentLog {
  id: string;
  agent: 'architect' | 'builder';
  action: string;
  details: string;
  status: 'pending' | 'success' | 'error';
  timestamp: Date;
}
