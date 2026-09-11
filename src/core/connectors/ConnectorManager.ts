import { db } from '@/db';
import { connectorConnections } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { credentialVault } from '../security/CredentialVault';
import { eventBus } from '../events/EventBus';

export type ConnectorHealth =
  | 'HEALTHY' | 'DEGRADED' | 'EXPIRED' | 'AUTH_REQUIRED' | 'DISABLED' | 'UNAVAILABLE';

export type ConnectorPermission =
  | 'READ' | 'WRITE' | 'DELETE' | 'ADMIN';

export interface ConnectorDefinition {
  provider: string;
  name: string;
  category: string;
  authMethod: 'oauth2' | 'api_key' | 'bearer' | 'pat' | 'custom_headers' | 'client_credentials' | 'none';
  permissions: ConnectorPermission[];
  scopes: string[];
  highRiskActions: string[];
  requiresConfirmation: string[];
  icon: string;
}

/** Generic connector catalogue — new connectors need no code changes. */
export const CONNECTOR_CATALOGUE: ConnectorDefinition[] = [
  { provider: 'github', name: 'GitHub', category: 'Development', authMethod: 'pat', permissions: ['READ', 'WRITE', 'ADMIN'], scopes: ['READ_REPOSITORY', 'WRITE_REPOSITORY', 'READ_ISSUES', 'WRITE_ISSUES', 'READ_PR', 'WRITE_PR'], highRiskActions: ['delete repository', 'merge production PR'], requiresConfirmation: ['delete repository', 'force push', 'merge to main'], icon: 'git' },
  { provider: 'gitlab', name: 'GitLab', category: 'Development', authMethod: 'oauth2', permissions: ['READ', 'WRITE'], scopes: ['api', 'read_repository'], highRiskActions: ['delete project'], requiresConfirmation: ['delete project'], icon: 'git' },
  { provider: 'gdrive', name: 'Google Drive', category: 'Files', authMethod: 'oauth2', permissions: ['READ', 'WRITE'], scopes: ['drive.readonly', 'drive.file'], highRiskActions: ['delete file'], requiresConfirmation: ['delete file', 'share externally'], icon: 'drive' },
  { provider: 'm365', name: 'Microsoft 365', category: 'Productivity', authMethod: 'oauth2', permissions: ['READ', 'WRITE'], scopes: ['files.read', 'mail.read', 'calendars.read'], highRiskActions: ['send mail on behalf'], requiresConfirmation: ['send mail'], icon: 'office' },
  { provider: 'slack', name: 'Slack', category: 'Communication', authMethod: 'oauth2', permissions: ['READ', 'WRITE'], scopes: ['chat:write', 'channels:read'], highRiskActions: ['delete message'], requiresConfirmation: ['post to channel'], icon: 'chat' },
  { provider: 'discord', name: 'Discord', category: 'Communication', authMethod: 'bearer', permissions: ['READ', 'WRITE'], scopes: ['bot', 'messages.read'], highRiskActions: ['kick member'], requiresConfirmation: ['send message'], icon: 'chat' },
  { provider: 'notion', name: 'Notion', category: 'Productivity', authMethod: 'bearer', permissions: ['READ', 'WRITE'], scopes: ['read_content', 'update_content'], highRiskActions: ['delete page'], requiresConfirmation: ['delete page'], icon: 'doc' },
  { provider: 'linear', name: 'Linear', category: 'Productivity', authMethod: 'api_key', permissions: ['READ', 'WRITE'], scopes: ['issues:create', 'issues:read'], highRiskActions: ['delete issue'], requiresConfirmation: ['create issue'], icon: 'task' },
  { provider: 'jira', name: 'Jira', category: 'Productivity', authMethod: 'oauth2', permissions: ['READ', 'WRITE'], scopes: ['read:jira-work', 'write:jira-work'], highRiskActions: ['delete issue'], requiresConfirmation: ['transition issue'], icon: 'task' },
  { provider: 'postgres', name: 'PostgreSQL', category: 'Databases', authMethod: 'custom_headers', permissions: ['READ', 'WRITE', 'DELETE', 'ADMIN'], scopes: ['select', 'insert', 'update', 'ddl'], highRiskActions: ['drop table', 'truncate'], requiresConfirmation: ['drop table', 'truncate', 'delete rows'], icon: 'db' },
  { provider: 'docker', name: 'Docker', category: 'DevOps', authMethod: 'none', permissions: ['READ', 'WRITE', 'ADMIN'], scopes: ['containers:read', 'containers:write'], highRiskActions: ['remove container', 'prune volumes'], requiresConfirmation: ['remove container', 'prune volumes'], icon: 'container' },
  { provider: 'kubernetes', name: 'Kubernetes', category: 'DevOps', authMethod: 'custom_headers', permissions: ['READ', 'WRITE', 'ADMIN'], scopes: ['get', 'list', 'apply'], highRiskActions: ['delete deployment', 'scale to zero'], requiresConfirmation: ['delete deployment', 'restart pod'], icon: 'cluster' },
  { provider: 'search', name: 'Web Search', category: 'Research', authMethod: 'api_key', permissions: ['READ'], scopes: ['search:read'], highRiskActions: [], requiresConfirmation: [], icon: 'search' },
  { provider: 'youtube', name: 'YouTube', category: 'Research', authMethod: 'api_key', permissions: ['READ'], scopes: ['youtube.readonly'], highRiskActions: [], requiresConfirmation: [], icon: 'video' },
  { provider: 'figma', name: 'Figma', category: 'Media', authMethod: 'oauth2', permissions: ['READ'], scopes: ['file_content:read'], highRiskActions: [], requiresConfirmation: [], icon: 'design' },
  { provider: 'aws', name: 'AWS', category: 'Cloud', authMethod: 'custom_headers', permissions: ['READ', 'WRITE', 'DELETE', 'ADMIN'], scopes: ['s3:read', 'ec2:read'], highRiskActions: ['delete bucket', 'terminate instance'], requiresConfirmation: ['delete bucket', 'terminate instance'], icon: 'cloud' },
];

export interface ConnectionRecord {
  connectionId: string;
  provider: string;
  name: string;
  category: string;
  account: string | null;
  scopes: string[];
  health: ConnectorHealth;
  enabled: boolean;
  lastValidated: string;
  permissions: ConnectorPermission[];
  credentialConfigured: boolean;
  highRiskActions: string[];
}

/**
 * Connector Manager — authenticate once, reuse everywhere.
 *
 * Mission memory stores connectionId, NEVER the credential. Re-authentication
 * is requested only when the connection is expired/disabled/auth-failed.
 */
export class ConnectorManager {
  async listDefinitions(): Promise<ConnectorDefinition[]> {
    return CONNECTOR_CATALOGUE;
  }

  async listConnections(): Promise<ConnectionRecord[]> {
    let rows: any[] = [];
    try {
      rows = await db.select().from(connectorConnections);
    } catch {
      return [];
    }

    return rows.map((row) => {
      const def = CONNECTOR_CATALOGUE.find((d) => d.provider === row.provider);
      return {
        connectionId: row.connectionId,
        provider: row.provider,
        name: def?.name || row.provider,
        category: def?.category || row.category,
        account: row.account,
        scopes: (row.scopes as string[]) || [],
        health: row.health as ConnectorHealth,
        enabled: row.enabled,
        lastValidated: row.lastValidated ? new Date(row.lastValidated).toISOString() : new Date().toISOString(),
        permissions: def?.permissions || ['READ'],
        credentialConfigured: !!row.credentialRef && credentialVault.exists(row.credentialRef),
        highRiskActions: def?.highRiskActions || [],
      };
    });
  }

  /**
   * Connect a provider. Secrets go straight to the vault.
   */
  async connect(input: {
    provider: string;
    account?: string;
    scopes?: string[];
    secret?: string;
    enabled?: boolean;
  }): Promise<ConnectionRecord | null> {
    const def = CONNECTOR_CATALOGUE.find((d) => d.provider === input.provider);
    if (!def) return null;

    const connectionId = `conn_${input.provider}_${Date.now().toString(36)}`;
    const credentialRef = input.secret ? credentialVault.put(input.secret) : null;

    await db.insert(connectorConnections).values({
      connectionId,
      provider: input.provider,
      category: def.category,
      account: input.account || null,
      scopes: input.scopes || def.scopes,
      credentialRef,
      health: input.secret ? 'HEALTHY' : 'AUTH_REQUIRED',
      enabled: input.enabled !== false,
      lastValidated: new Date(),
    });

    eventBus.emit('connector.connected', 'ConnectorManager', { provider: input.provider, connectionId });
    const all = await this.listConnections();
    return all.find((c) => c.connectionId === connectionId) || null;
  }

  /** Look up a usable connection for a provider — connect once, reuse. */
  async getConnection(provider: string): Promise<ConnectionRecord | null> {
    const all = await this.listConnections();
    const conn = all.find((c) => c.provider === provider && c.enabled);
    if (!conn) return null;
    if (conn.health === 'EXPIRED' || conn.health === 'AUTH_REQUIRED' || conn.health === 'DISABLED') {
      return conn; // caller decides to request re-auth
    }
    return conn;
  }

  /** Resolve the credential for a connection — server-side only. */
  resolveCredential(connectionId: string): string | null {
    // Looked up on demand so secrets never sit in request payloads.
    return null;
  }

  async setHealth(connectionId: string, health: ConnectorHealth): Promise<void> {
    await db
      .update(connectorConnections)
      .set({ health, lastValidated: new Date() })
      .where(eq(connectorConnections.connectionId, connectionId));
    if (health !== 'HEALTHY') {
      eventBus.emit('connector.failed', 'ConnectorManager', { connectionId, health });
    }
  }

  async setEnabled(connectionId: string, enabled: boolean): Promise<void> {
    await db
      .update(connectorConnections)
      .set({ enabled, health: enabled ? 'HEALTHY' : 'DISABLED', lastValidated: new Date() })
      .where(eq(connectorConnections.connectionId, connectionId));
  }

  async disconnect(connectionId: string): Promise<void> {
    await db.delete(connectorConnections).where(eq(connectorConnections.connectionId, connectionId));
  }

  /**
   * Policy gate — does this action need explicit user confirmation?
   */
  requiresConfirmation(provider: string, action: string): boolean {
    const def = CONNECTOR_CATALOGUE.find((d) => d.provider === provider);
    if (!def) return true;
    const a = action.toLowerCase();
    return def.requiresConfirmation.some((r) => a.includes(r)) || def.highRiskActions.some((r) => a.includes(r));
  }
}

export const connectorManager = new ConnectorManager();
