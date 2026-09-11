export interface MemoryEntry {
  id: string;
  category: 'short_term' | 'long_term' | 'project_memory' | 'preference' | 'task_memory' | 'device_memory' | 'knowledge';
  content: string;
  embedding?: number[];
  metadata: Record<string, any>;
  userId?: string; // For multi-user
  timestamp: number;
  expiresAt?: number;
  accessCount: number;
  importance: number; // 0-1
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  similarity?: number;
  relevanceScore: number;
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  source?: string;
  indexedAt: number;
  embeddings?: number[];
  tags: string[];
}

export class MemorySystem {
  private memories = new Map<string, MemoryEntry>();
  private knowledgeBase = new Map<string, KnowledgeDocument>();
  private userProfiles = new Map<string, { preferences: Record<string, any>; voiceProfile?: string; authorizedDevices: string[] }>();

  constructor() {
    console.log('[MEMORY] Memory system initialized');
  }

  storeMemory(entry: MemoryEntry) {
    this.memories.set(entry.id, entry);
  }

  retrieveMemory(id: string): MemoryEntry | undefined {
    const entry = this.memories.get(id);
    if (entry) entry.accessCount++;
    return entry;
  }

  searchMemory(query: string, category?: string, userId?: string): MemorySearchResult[] {
    const results: MemorySearchResult[] = [];
    const queryLower = query.toLowerCase();
    
    for (const [id, entry] of this.memories) {
      if (category && entry.category !== category) continue;
      if (userId && entry.userId && entry.userId !== userId) continue;
      
      const contentLower = entry.content.toLowerCase();
      const relevance = contentLower.includes(queryLower) ? 0.9 : 0.3;
      
      if (relevance > 0.2) {
        results.push({ entry, relevanceScore: relevance });
      }
    }
    
    return results.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, 10);
  }

  addKnowledgeDocument(doc: KnowledgeDocument) {
    this.knowledgeBase.set(doc.id, doc);
  }

  searchKnowledge(query: string): KnowledgeDocument[] {
    const results: KnowledgeDocument[] = [];
    const queryLower = query.toLowerCase();
    
    for (const doc of this.knowledgeBase.values()) {
      if (doc.content.toLowerCase().includes(queryLower) || doc.tags.some((t) => t.toLowerCase().includes(queryLower))) {
        results.push(doc);
      }
    }
    return results;
  }

  forgetMemory(id: string) {
    this.memories.delete(id);
  }

  forgetCategory(category: MemoryEntry['category']) {
    for (const [id, entry] of this.memories) {
      if (entry.category === category) {
        this.memories.delete(id);
      }
    }
  }

  getAllMemories(): MemoryEntry[] {
    return Array.from(this.memories.values());
  }

  registerUserProfile(userId: string, profile: { preferences: Record<string, any>; voiceProfile?: string; authorizedDevices: string[] }) {
    this.userProfiles.set(userId, profile);
  }

  getUserProfile(userId: string) {
    return this.userProfiles.get(userId);
  }

  getMemoryStats() {
    const categories: Record<string, number> = {};
    for (const entry of this.memories.values()) {
      categories[entry.category] = (categories[entry.category] || 0) + 1;
    }
    return {
      total: this.memories.size,
      categories,
      knowledgeDocs: this.knowledgeBase.size,
    };
  }
}

export const memorySystem = new MemorySystem();
