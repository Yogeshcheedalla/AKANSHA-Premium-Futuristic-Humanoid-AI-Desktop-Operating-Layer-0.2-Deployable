CREATE TABLE "action_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(48) NOT NULL,
	"request_id" varchar(128),
	"action_id" varchar(128),
	"mission_id" varchar(128),
	"payload" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_executions" (
	"request_id" varchar(128) PRIMARY KEY NOT NULL,
	"action_id" varchar(128) NOT NULL,
	"user_id" varchar(128),
	"mission_id" varchar(128),
	"status" varchar(24) NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb,
	"failure" jsonb,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "agent_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" varchar(128) NOT NULL,
	"agent_id" varchar(64) NOT NULL,
	"goal" text NOT NULL,
	"status" varchar(32) DEFAULT 'QUEUED' NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb,
	"tools" jsonb DEFAULT '[]'::jsonb,
	"progress" integer DEFAULT 0 NOT NULL,
	"logs" jsonb DEFAULT '[]'::jsonb,
	"result" jsonb DEFAULT '{}'::jsonb,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	CONSTRAINT "agent_tasks_task_id_unique" UNIQUE("task_id")
);
--> statement-breakpoint
CREATE TABLE "ambient_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" varchar(128) NOT NULL,
	"type" varchar(40) NOT NULL,
	"source" varchar(96) NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"urgency" double precision DEFAULT 0.3 NOT NULL,
	"importance" double precision DEFAULT 0.3 NOT NULL,
	"relevance" double precision DEFAULT 0.3 NOT NULL,
	"trust_level" varchar(32) DEFAULT 'UNKNOWN' NOT NULL,
	"quarantined" boolean DEFAULT false NOT NULL,
	"requires_action" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ambient_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"mission_id" varchar(128),
	"user_id" varchar(64),
	"payload" jsonb DEFAULT '{}'::jsonb,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"correlation_id" varchar(128) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capabilities" (
	"id" serial PRIMARY KEY NOT NULL,
	"capability_id" varchar(128) NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"provider" text NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"reliability_score" double precision DEFAULT 0.8,
	"success_rate" double precision DEFAULT 0.8,
	"latency_ms" integer DEFAULT 500,
	"permissions" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	CONSTRAINT "capabilities_capability_id_unique" UNIQUE("capability_id")
);
--> statement-breakpoint
CREATE TABLE "connector_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" varchar(128) NOT NULL,
	"provider" varchar(64) NOT NULL,
	"category" varchar(48) NOT NULL,
	"account" text,
	"scopes" jsonb DEFAULT '[]'::jsonb,
	"credential_ref" varchar(128),
	"health" varchar(32) DEFAULT 'HEALTHY' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_validated" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "connector_connections_connection_id_unique" UNIQUE("connection_id")
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"ref" varchar(128) NOT NULL,
	"encrypted" text NOT NULL,
	"iv" varchar(64) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credentials_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "decision_traces" (
	"id" serial PRIMARY KEY NOT NULL,
	"trace_id" varchar(128) NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"mission_id" varchar(128),
	"kind" varchar(32) NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb,
	"selected" jsonb DEFAULT '{}'::jsonb,
	"reasons" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "decision_traces_trace_id_unique" UNIQUE("trace_id")
);
--> statement-breakpoint
CREATE TABLE "device_sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"device_id" varchar(128),
	"platform" varchar(24),
	"token_hash" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "experiences" (
	"id" serial PRIMARY KEY NOT NULL,
	"experience_id" varchar(128) NOT NULL,
	"task" text NOT NULL,
	"intent" varchar(48) NOT NULL,
	"result" varchar(16) NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb,
	"model" jsonb DEFAULT '{}'::jsonb,
	"observations" jsonb DEFAULT '[]'::jsonb,
	"verification" jsonb DEFAULT '{}'::jsonb,
	"failure" jsonb DEFAULT '{}'::jsonb,
	"correction" text,
	"user_feedback" jsonb DEFAULT '{}'::jsonb,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "experiences_experience_id_unique" UNIQUE("experience_id")
);
--> statement-breakpoint
CREATE TABLE "interruption_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"notification_id" varchar(128) NOT NULL,
	"title" text NOT NULL,
	"decision" varchar(24) NOT NULL,
	"score" integer NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb,
	"user_state" varchar(32),
	"accepted" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"kind" varchar(64) NOT NULL,
	"status" varchar(24) NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"result" jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_id" varchar(128) NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"source" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"indexed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_documents_doc_id_unique" UNIQUE("doc_id")
);
--> statement-breakpoint
CREATE TABLE "learned_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"capability" varchar(96) NOT NULL,
	"scope" varchar(96) DEFAULT 'global' NOT NULL,
	"value" boolean NOT NULL,
	"mean" double precision DEFAULT 0.5 NOT NULL,
	"confidence" double precision DEFAULT 0.5 NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"risk_tier" varchar(12) DEFAULT 'low' NOT NULL,
	"source" varchar(16) DEFAULT 'implicit' NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" serial PRIMARY KEY NOT NULL,
	"lesson_id" varchar(160) NOT NULL,
	"domain" varchar(96) NOT NULL,
	"outcome" varchar(12) NOT NULL,
	"lesson" text NOT NULL,
	"recommended_change" text,
	"evidence_count" integer DEFAULT 1 NOT NULL,
	"confidence" double precision DEFAULT 0.4 NOT NULL,
	"applies_to" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lessons_lesson_id_unique" UNIQUE("lesson_id")
);
--> statement-breakpoint
CREATE TABLE "memory_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"memory_id" varchar(128) NOT NULL,
	"user_id" varchar(64),
	"category" varchar(32) NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"importance" double precision DEFAULT 0.5,
	"confidence" double precision DEFAULT 0.5,
	"access_count" integer DEFAULT 0,
	"expires_at" timestamp,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memory_entries_memory_id_unique" UNIQUE("memory_id")
);
--> statement-breakpoint
CREATE TABLE "memory_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"memory_id" varchar(128) NOT NULL,
	"type" varchar(24) NOT NULL,
	"content" text NOT NULL,
	"scope" varchar(96) DEFAULT 'global' NOT NULL,
	"owner" varchar(64) DEFAULT 'boss' NOT NULL,
	"importance" double precision DEFAULT 0.5 NOT NULL,
	"confidence" double precision DEFAULT 0.5 NOT NULL,
	"sensitivity" varchar(16) DEFAULT 'normal' NOT NULL,
	"trust_level" varchar(32) DEFAULT 'UNKNOWN' NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"links" jsonb DEFAULT '[]'::jsonb,
	"access_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memory_records_memory_id_unique" UNIQUE("memory_id")
);
--> statement-breakpoint
CREATE TABLE "mission_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_id" integer,
	"step_id" varchar(64) NOT NULL,
	"step_type" varchar(32) NOT NULL,
	"description" text,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb,
	"attempt_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "missions" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_id" varchar(128) NOT NULL,
	"user_id" varchar(64),
	"goal" text NOT NULL,
	"status" varchar(32) DEFAULT 'QUEUED' NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb,
	"artifacts" jsonb DEFAULT '[]'::jsonb,
	"observations" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "missions_mission_id_unique" UNIQUE("mission_id")
);
--> statement-breakpoint
CREATE TABLE "model_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" varchar(96) NOT NULL,
	"name" text NOT NULL,
	"type" varchar(32) NOT NULL,
	"base_url" text,
	"credential_ref" varchar(128),
	"default_model" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"fallback_priority" integer DEFAULT 100 NOT NULL,
	"policy" varchar(32) DEFAULT 'BALANCED' NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"health" jsonb DEFAULT '{"status":"UNKNOWN","latencyMs":0}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "model_providers_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
CREATE TABLE "provider_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" varchar(96) NOT NULL,
	"model_id" text NOT NULL,
	"display_name" text,
	"capabilities" jsonb DEFAULT '{}'::jsonb,
	"context_window" integer,
	"latency_ms" integer,
	"health_score" double precision DEFAULT 1,
	"available" boolean DEFAULT true NOT NULL,
	"discovered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"intent" varchar(48),
	"status" varchar(32) NOT NULL,
	"response" jsonb DEFAULT '{}'::jsonb,
	"latency_ms" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "request_ledger_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "skill_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"skill_id" varchar(128) NOT NULL,
	"version" varchar(24) NOT NULL,
	"lifecycle" varchar(20) DEFAULT 'GENERATED' NOT NULL,
	"parent_version" varchar(24),
	"change_description" text,
	"test_results" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"promoted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"display_name" text,
	"voice_profile" text,
	"preferences" jsonb DEFAULT '{}'::jsonb,
	"authorized_devices" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_state_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"state" varchar(32) NOT NULL,
	"confidence" double precision DEFAULT 0.5 NOT NULL,
	"signals_used" jsonb DEFAULT '[]'::jsonb,
	"interruptibility" varchar(20) DEFAULT 'normal' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mission_steps" ADD CONSTRAINT "mission_steps_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE no action ON UPDATE no action;