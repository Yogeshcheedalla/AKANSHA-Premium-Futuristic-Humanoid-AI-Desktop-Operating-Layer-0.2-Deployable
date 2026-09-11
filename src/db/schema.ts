import { pgTable, serial, text, timestamp, integer, jsonb, boolean, varchar, doublePrecision } from 'drizzle-orm/pg-core';

/* ─────────────── USERS & MEMORY ─────────────── */

export const userProfiles = pgTable('user_profiles', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 64 }).notNull().unique(),
  displayName: text('display_name'),
  voiceProfile: text('voice_profile'),
  preferences: jsonb('preferences').default({}),
  authorizedDevices: jsonb('authorized_devices').default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const memoryEntries = pgTable('memory_entries', {
  id: serial('id').primaryKey(),
  memoryId: varchar('memory_id', { length: 128 }).notNull().unique(),
  userId: varchar('user_id', { length: 64 }),
  // working | episodic | semantic | procedural | preference
  category: varchar('category', { length: 32 }).notNull(),
  content: text('content').notNull(),
  metadata: jsonb('metadata').default({}),
  importance: doublePrecision('importance').default(0.5),
  confidence: doublePrecision('confidence').default(0.5),
  accessCount: integer('access_count').default(0),
  expiresAt: timestamp('expires_at'),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
});

export const knowledgeDocuments = pgTable('knowledge_documents', {
  id: serial('id').primaryKey(),
  docId: varchar('doc_id', { length: 128 }).notNull().unique(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  source: text('source'),
  tags: jsonb('tags').default([]),
  indexedAt: timestamp('indexed_at').defaultNow().notNull(),
});

/* ─────────────── UNIVERSAL MODEL PROVIDERS ─────────────── */

export const modelProviders = pgTable('model_providers', {
  id: serial('id').primaryKey(),
  providerId: varchar('provider_id', { length: 96 }).notNull().unique(),
  name: text('name').notNull(),
  // ollama | openai | gemini | openai-compatible | local | custom
  type: varchar('type', { length: 32 }).notNull(),
  baseUrl: text('base_url'),
  // Reference to the secret vault — NEVER the raw key itself.
  credentialRef: varchar('credential_ref', { length: 128 }),
  defaultModel: text('default_model'),
  enabled: boolean('enabled').default(true).notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  fallbackPriority: integer('fallback_priority').default(100).notNull(),
  // LOCAL_ONLY | CLOUD_ONLY | PREFERRED_LOCAL | PREFERRED_CLOUD | BALANCED | MANUAL
  policy: varchar('policy', { length: 32 }).default('BALANCED').notNull(),
  capabilities: jsonb('capabilities').default({}),
  settings: jsonb('settings').default({}),
  health: jsonb('health').default({ status: 'UNKNOWN', latencyMs: 0 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const providerModels = pgTable('provider_models', {
  id: serial('id').primaryKey(),
  providerId: varchar('provider_id', { length: 96 }).notNull(),
  modelId: text('model_id').notNull(),
  displayName: text('display_name'),
  capabilities: jsonb('capabilities').default({}),
  contextWindow: integer('context_window'),
  latencyMs: integer('latency_ms'),
  healthScore: doublePrecision('health_score').default(1.0),
  available: boolean('available').default(true).notNull(),
  discoveredAt: timestamp('discovered_at').defaultNow().notNull(),
});

/**
 * Durable backing store for the CredentialVault. Stores ONLY encrypted
 * envelopes (AES-256-GCM ciphertext+tag and IV, base64). Raw secrets are never
 * written here. Hydrated into the vault's in-memory cache at startup so API
 * keys survive process restarts.
 */
export const credentials = pgTable('credentials', {
  id: serial('id').primaryKey(),
  ref: varchar('ref', { length: 128 }).notNull().unique(),
  encrypted: text('encrypted').notNull(),
  iv: varchar('iv', { length: 64 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/* ─────────────── CONNECTORS ─────────────── */

export const connectorConnections = pgTable('connector_connections', {
  id: serial('id').primaryKey(),
  connectionId: varchar('connection_id', { length: 128 }).notNull().unique(),
  provider: varchar('provider', { length: 64 }).notNull(),
  category: varchar('category', { length: 48 }).notNull(),
  account: text('account'),
  scopes: jsonb('scopes').default([]),
  credentialRef: varchar('credential_ref', { length: 128 }),
  // HEALTHY | DEGRADED | EXPIRED | AUTH_REQUIRED | DISABLED | UNAVAILABLE
  health: varchar('health', { length: 32 }).default('HEALTHY').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  lastValidated: timestamp('last_validated').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/* ─────────────── CAPABILITIES / SKILLS / MISSIONS ─────────────── */

export const capabilities = pgTable('capabilities', {
  id: serial('id').primaryKey(),
  capabilityId: varchar('capability_id', { length: 128 }).notNull().unique(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  provider: text('provider').notNull(),
  available: boolean('available').default(true).notNull(),
  reliabilityScore: doublePrecision('reliability_score').default(0.8),
  successRate: doublePrecision('success_rate').default(0.8),
  latencyMs: integer('latency_ms').default(500),
  permissions: jsonb('permissions').default([]),
  metadata: jsonb('metadata').default({}),
});

export const missions = pgTable('missions', {
  id: serial('id').primaryKey(),
  missionId: varchar('mission_id', { length: 128 }).notNull().unique(),
  userId: varchar('user_id', { length: 64 }),
  goal: text('goal').notNull(),
  status: varchar('status', { length: 32 }).notNull().default('QUEUED'),
  context: jsonb('context').default({}),
  artifacts: jsonb('artifacts').default([]),
  observations: jsonb('observations').default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const missionSteps = pgTable('mission_steps', {
  id: serial('id').primaryKey(),
  missionId: integer('mission_id').references(() => missions.id),
  stepId: varchar('step_id', { length: 64 }).notNull(),
  stepType: varchar('step_type', { length: 32 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 32 }).notNull().default('PENDING'),
  result: jsonb('result').default({}),
  attemptCount: integer('attempt_count').default(0).notNull(),
});

export const agentTasks = pgTable('agent_tasks', {
  id: serial('id').primaryKey(),
  taskId: varchar('task_id', { length: 128 }).notNull().unique(),
  agentId: varchar('agent_id', { length: 64 }).notNull(),
  goal: text('goal').notNull(),
  status: varchar('status', { length: 32 }).notNull().default('QUEUED'),
  permissions: jsonb('permissions').default([]),
  tools: jsonb('tools').default([]),
  progress: integer('progress').default(0).notNull(),
  logs: jsonb('logs').default([]),
  result: jsonb('result').default({}),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  finishedAt: timestamp('finished_at'),
});

/* ─────────────── OBSERVABILITY ─────────────── */

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  eventType: varchar('event_type', { length: 64 }).notNull(),
  missionId: varchar('mission_id', { length: 128 }),
  userId: varchar('user_id', { length: 64 }),
  payload: jsonb('payload').default({}),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
  correlationId: varchar('correlation_id', { length: 128 }).notNull(),
});

export const decisionTraces = pgTable('decision_traces', {
  id: serial('id').primaryKey(),
  traceId: varchar('trace_id', { length: 128 }).notNull().unique(),
  requestId: varchar('request_id', { length: 128 }).notNull(),
  missionId: varchar('mission_id', { length: 128 }),
  kind: varchar('kind', { length: 32 }).notNull(), // model | capability | recovery
  candidates: jsonb('candidates').default([]),
  selected: jsonb('selected').default({}),
  reasons: jsonb('reasons').default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const requestLedger = pgTable('request_ledger', {
  id: serial('id').primaryKey(),
  requestId: varchar('request_id', { length: 128 }).notNull().unique(),
  intent: varchar('intent', { length: 48 }),
  status: varchar('status', { length: 32 }).notNull(),
  response: jsonb('response').default({}),
  latencyMs: integer('latency_ms').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/* ─────────────── AKANSHA 2.0 — COGNITIVE LAYER ─────────────── */

export const memoryRecords = pgTable('memory_records', {
  id: serial('id').primaryKey(),
  memoryId: varchar('memory_id', { length: 128 }).notNull().unique(),
  type: varchar('type', { length: 24 }).notNull(),
  content: text('content').notNull(),
  scope: varchar('scope', { length: 96 }).default('global').notNull(),
  owner: varchar('owner', { length: 64 }).default('boss').notNull(),
  importance: doublePrecision('importance').default(0.5).notNull(),
  confidence: doublePrecision('confidence').default(0.5).notNull(),
  sensitivity: varchar('sensitivity', { length: 16 }).default('normal').notNull(),
  trustLevel: varchar('trust_level', { length: 32 }).default('UNKNOWN').notNull(),
  provenance: jsonb('provenance').default({}),
  tags: jsonb('tags').default([]),
  links: jsonb('links').default([]),
  accessCount: integer('access_count').default(0).notNull(),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const learnedPreferences = pgTable('learned_preferences', {
  id: serial('id').primaryKey(),
  capability: varchar('capability', { length: 96 }).notNull(),
  scope: varchar('scope', { length: 96 }).default('global').notNull(),
  value: boolean('value').notNull(),
  mean: doublePrecision('mean').default(0.5).notNull(),
  confidence: doublePrecision('confidence').default(0.5).notNull(),
  evidenceCount: integer('evidence_count').default(0).notNull(),
  riskTier: varchar('risk_tier', { length: 12 }).default('low').notNull(),
  source: varchar('source', { length: 16 }).default('implicit').notNull(),
  lastUpdated: timestamp('last_updated').defaultNow().notNull(),
});

export const experiences = pgTable('experiences', {
  id: serial('id').primaryKey(),
  experienceId: varchar('experience_id', { length: 128 }).notNull().unique(),
  task: text('task').notNull(),
  intent: varchar('intent', { length: 48 }).notNull(),
  result: varchar('result', { length: 16 }).notNull(),
  tools: jsonb('tools').default([]),
  model: jsonb('model').default({}),
  observations: jsonb('observations').default([]),
  verification: jsonb('verification').default({}),
  failure: jsonb('failure').default({}),
  correction: text('correction'),
  userFeedback: jsonb('user_feedback').default({}),
  durationMs: integer('duration_ms').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const lessons = pgTable('lessons', {
  id: serial('id').primaryKey(),
  lessonId: varchar('lesson_id', { length: 160 }).notNull().unique(),
  domain: varchar('domain', { length: 96 }).notNull(),
  outcome: varchar('outcome', { length: 12 }).notNull(),
  lesson: text('lesson').notNull(),
  recommendedChange: text('recommended_change'),
  evidenceCount: integer('evidence_count').default(1).notNull(),
  confidence: doublePrecision('confidence').default(0.4).notNull(),
  appliesTo: jsonb('applies_to').default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const ambientEvents = pgTable('ambient_events', {
  id: serial('id').primaryKey(),
  eventId: varchar('event_id', { length: 128 }).notNull().unique(),
  type: varchar('type', { length: 40 }).notNull(),
  source: varchar('source', { length: 96 }).notNull(),
  title: text('title').notNull(),
  detail: text('detail'),
  urgency: doublePrecision('urgency').default(0.3).notNull(),
  importance: doublePrecision('importance').default(0.3).notNull(),
  relevance: doublePrecision('relevance').default(0.3).notNull(),
  trustLevel: varchar('trust_level', { length: 32 }).default('UNKNOWN').notNull(),
  quarantined: boolean('quarantined').default(false).notNull(),
  requiresAction: boolean('requires_action').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const skillVersions = pgTable('skill_versions', {
  id: serial('id').primaryKey(),
  skillId: varchar('skill_id', { length: 128 }).notNull(),
  version: varchar('version', { length: 24 }).notNull(),
  lifecycle: varchar('lifecycle', { length: 20 }).default('GENERATED').notNull(),
  parentVersion: varchar('parent_version', { length: 24 }),
  changeDescription: text('change_description'),
  testResults: jsonb('test_results').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  promotedAt: timestamp('promoted_at'),
});

export const userStateLog = pgTable('user_state_log', {
  id: serial('id').primaryKey(),
  state: varchar('state', { length: 32 }).notNull(),
  confidence: doublePrecision('confidence').default(0.5).notNull(),
  signalsUsed: jsonb('signals_used').default([]),
  interruptibility: varchar('interruptibility', { length: 20 }).default('normal').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const interruptionDecisions = pgTable('interruption_decisions', {
  id: serial('id').primaryKey(),
  notificationId: varchar('notification_id', { length: 128 }).notNull(),
  title: text('title').notNull(),
  decision: varchar('decision', { length: 24 }).notNull(),
  score: integer('score').notNull(),
  reasons: jsonb('reasons').default([]),
  userState: varchar('user_state', { length: 32 }),
  accepted: boolean('accepted'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
