import { useEffect, useState } from 'react';
import { BackendService } from '../services/AssemblyBackendService';
import { Workspace, FileNode, ChatMessage, AgentLog } from '../types';

export function useSimulation() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [architectChat, setArchitectChat] = useState<ChatMessage[]>([]);
  const [builderLogs, setBuilderLogs] = useState<AgentLog[]>([]);
  const [fileTreeError, setFileTreeError] = useState<string | null>(null);

  useEffect(() => {
    const subs = [
      BackendService.workspaces$.subscribe(setWorkspaces),
      BackendService.activeWorkspace$.subscribe(setActiveWorkspace),
      BackendService.fileTree$.subscribe(setFileTree),
      BackendService.architectChat$.subscribe(setArchitectChat),
      BackendService.builderLogs$.subscribe(setBuilderLogs),
      BackendService.fileTreeError$.subscribe(setFileTreeError),
    ];

    // Live mode: load the real file tree from file-system-server on mount.
    if (BackendService.isLiveFileMode()) {
      BackendService.loadLiveFileTree();
    }

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
    fileTreeError,
    isLiveFileMode: BackendService.isLiveFileMode(),
    readLiveFile: (path: string[], name: string) => BackendService.readLiveFile(path, name),
    saveLiveFile: (path: string[], name: string, content: string) => BackendService.saveLiveFile(path, name, content),
    BackendService,
  };
}
