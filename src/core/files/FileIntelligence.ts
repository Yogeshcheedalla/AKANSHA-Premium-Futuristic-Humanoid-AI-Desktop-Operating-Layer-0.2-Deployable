import { eventBus } from '../events/EventBus';

export interface FileDescriptor {
  fileId: string;
  source: 'filesystem' | 'git' | 'worktree' | 'browser' | 'cloud' | 'upload' | 'generated';
  path: string;
  mimeType: string;
  ownerContext?: string;
  permissions: string[];
  hash?: string;
  version?: number;
  createdAt: number;
  modifiedAt: number;
  relatedMission?: string;
  relatedSkill?: string;
}

/**
 * File Intelligence Layer — files are first-class capabilities.
 * Every file has identity, source, permissions, hash, and mission/skill
 * correlation. No agent guesses unseen file contents; no agent accesses
 * the entire filesystem arbitrarily.
 */
export class FileIntelligence {
  private files = new Map<string, FileDescriptor>();

  register(file: FileDescriptor) {
    this.files.set(file.fileId, file);
    eventBus.emit('tool.completed', 'FileIntelligence', { tool: 'file.register', fileId: file.fileId, path: file.path });
  }

  get(fileId: string): FileDescriptor | undefined {
    return this.files.get(fileId);
  }

  findByPath(path: string): FileDescriptor | undefined {
    return Array.from(this.files.values()).find((f) => f.path === path);
  }

  findByMission(missionId: string): FileDescriptor[] {
    return Array.from(this.files.values()).filter((f) => f.relatedMission === missionId);
  }

  findBySource(source: FileDescriptor['source']): FileDescriptor[] {
    return Array.from(this.files.values()).filter((f) => f.source === source);
  }

  /**
   * Classify a file for routing to the right capability.
   */
  classify(mimeType: string, path: string): string {
    const m = mimeType.toLowerCase();
    const p = path.toLowerCase();
    if (m.includes('image')) return 'vision';
    if (m.includes('pdf') || m.includes('docx') || m.includes('doc')) return 'document';
    if (m.includes('sheet') || m.includes('xls') || m.includes('csv')) return 'spreadsheet';
    if (p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.js') || p.endsWith('.py') || p.endsWith('.rs')) return 'source-code';
    if (p.endsWith('.json') || p.endsWith('.yml') || p.endsWith('.yaml') || p.endsWith('.toml')) return 'config';
    if (p.endsWith('.md') || p.endsWith('.txt')) return 'text';
    return 'generic';
  }

  /**
   * Check permissions before an agent accesses a file.
   */
  checkAccess(fileId: string, requiredPermission: string): boolean {
    const file = this.files.get(fileId);
    if (!file) return false;
    return file.permissions.includes(requiredPermission);
  }

  list(): FileDescriptor[] {
    return Array.from(this.files.values());
  }
}

export const fileIntelligence = new FileIntelligence();
