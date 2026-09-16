/**
 * Shared, TYPES-ONLY setup DTO. Safe to import from both server modules and
 * client ('use client') components — it has no runtime/server dependencies, so
 * it never pulls Node APIs (fs/os/crypto) into the browser bundle.
 */
export type CatalogStatus = 'ready' | 'fixture' | 'not-configured' | 'invalid';
export type CardState = 'AVAILABLE' | 'CHECKING' | 'INCOMPATIBLE' | 'INSTALLING' | 'VERIFYING' | 'FAILED' | 'READY' | 'BLOCKED';

export interface ModelCardVM {
  id: string; name: string; family: string; version: string; quantization?: string;
  format: string; downloadSizeBytes: number; installedSizeBytes: number;
  minimumRamGB: number; recommendedRamGB: number; minimumStorageGB: number;
  gpuRequirements?: { required: boolean; minVramGB?: number };
  runtimeRequirement: string; contextLength: number; capabilities: string[];
  quality: { chat: string; reasoning: string; coding: string }; license: string; sourceUrl: string;
  performanceLabel: 'Measured' | 'Estimated' | 'Unknown'; estimatedTokensPerSec?: number; memoryGB?: number;
  bestFor?: string; drawbacks?: string; internetRequired: boolean;
  compatibility: { score: number; rating: string; runnable: boolean; reasons: string[] };
  sha256Present: boolean; signed: boolean; installable: boolean;
}

export interface SetupViewModel {
  device: {
    platform: string; architecture: string; cpuModel: string; cpuCores: number; ramGB: number;
    freeDiskGB: number; gpu: { detected: boolean; vendor?: string; vramGB?: number };
    acceleration: string[]; tier: number;
  };
  runtime: { available: boolean; name: string; version?: string; supportsAcceleration: string[] };
  catalog: { status: CatalogStatus; reasons: string[]; fixture: boolean; models: ModelCardVM[] };
  aiMode: { recommended: 'offline' | 'cloud'; offlineReady: boolean; reason: string };
  online: { provider: string; connected: boolean; verified: boolean; configured: boolean; label?: string | null };
  readiness: { offline: string; online: string };
}

export interface InstallResult {
  ok: boolean; modelId?: string; stage?: string; action?: string; blocked?: string | null;
  compatibility?: { rating: string; runnable: boolean; reasons: string[]; performanceLabel: string };
  usable: boolean; runtimeAvailable?: boolean; reasons?: string[]; error?: string;
}
