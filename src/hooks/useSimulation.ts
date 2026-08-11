import { useEffect, useState } from 'react';
import { BackendService } from '../services/AssemblyBackendService';
import { Workspace, FileNode, ChatMessage, AgentLog } from '../types';

export function useSimulation() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [architectChat, setArchitectChat] = useState<ChatMessage[]>([]);
  const [builderLogs, setBuilderLogs] = useState<AgentLog[]>([]);

  useEffect(() => {
    const subs = [
      BackendService.workspaces$.subscribe(setWorkspaces),
      BackendService.activeWorkspace$.subscribe(setActiveWorkspace),
      BackendService.fileTree$.subscribe(setFileTree),
      BackendService.architectChat$.subscribe(setArchitectChat),
      BackendService.builderLogs$.subscribe(setBuilderLogs),
    ];

    return () => {
      subs.forEach(s => s.unsubscribe());
      BackendService.destroy();
    };
  }, []);

  return {
    workspaces,
    activeWorkspace,
    fileTree,
    architectChat,
    builderLogs,
    BackendService,
  };
}
