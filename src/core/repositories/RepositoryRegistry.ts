/**
 * Canonical Akansha Repository Registry.
 *
 * Every external repository is registered here with its layer, role,
 * integration mode, permissions, sandbox requirement and Windows
 * compatibility. NOTHING is merged into core — each repo is a capability
 * provider behind an interface.
 *
 * Status meanings:
 *   INTEGRATED    — a real adapter exists in this codebase
 *   ADAPTER_READY — adapter boundary defined; needs the runtime binary/service
 *   ARCHITECTURAL — its concepts are folded into Akansha core (no runtime dep)
 *   CATALOG       — discovery catalogue only, never a live dependency
 *   REFERENCE     — informs design; zero runtime coupling
 *   REJECTED      — evaluated and deliberately excluded, with a reason
 */

export type IntegrationStatus =
  | 'INTEGRATED'
  | 'ADAPTER_READY'
  | 'ARCHITECTURAL'
  | 'CATALOG'
  | 'REFERENCE'
  | 'REJECTED';

export type RepositoryLayer =
  | 'model'
  | 'memory'
  | 'orchestration'
  | 'browser'
  | 'computer-use'
  | 'coding'
  | 'avatar'
  | 'mcp'
  | 'workspace'
  | 'desktop'
  | 'evaluation'
  | 'reference';

export type IntegrationMode =
  | 'adapter'
  | 'sidecar'
  | 'subprocess'
  | 'mcp'
  | 'http'
  | 'ipc'
  | 'concepts'
  | 'none';

export interface RepositoryEntry {
  id: string;
  slug: string;
  url: string;
  name: string;
  description: string;
  layer: RepositoryLayer;
  roleInAkansha: string;
  status: IntegrationStatus;
  integrationMode: IntegrationMode;
  capabilitiesProvided: string[];
  permissions: string[];
  sandboxRequired: boolean;
  windowsCompatible: 'yes' | 'partial' | 'no' | 'n/a';
  fallbackFor?: string[];
  notes: string;
  rejectionReason?: string;
}

export const REPOSITORIES: RepositoryEntry[] = [
  /* ─────────────── MODEL INTELLIGENCE LAYER ─────────────── */
  {
    id: 'ollama',
    slug: 'ollama/ollama',
    url: 'https://github.com/ollama/ollama',
    name: 'Ollama',
    description: 'Local model management and inference runtime.',
    layer: 'model',
    roleInAkansha: 'Local model provider (OllamaProvider) — dynamic tag discovery.',
    status: 'INTEGRATED',
    integrationMode: 'http',
    capabilitiesProvided: ['model.chat.local', 'model.list', 'model.generate'],
    permissions: ['NETWORK_ACCESS_LOCAL'],
    sandboxRequired: false,
    windowsCompatible: 'yes',
    notes: 'Speaks OpenAI-compatible /v1 plus native /api/tags for richer metadata.',
  },
  {
    id: 'llama-cpp',
    slug: 'ggml-org/llama.cpp',
    url: 'https://github.com/ggml-org/llama.cpp',
    name: 'llama.cpp',
    description: 'High-performance local GGUF inference with an OpenAI-compatible server.',
    layer: 'model',
    roleInAkansha: 'Local GGUF inference server behind the OpenAI-compatible provider.',
    status: 'ADAPTER_READY',
    integrationMode: 'http',
    capabilitiesProvided: ['model.chat.local', 'model.embeddings', 'model.structured-output', 'model.batch'],
    permissions: ['NETWORK_ACCESS_LOCAL'],
    sandboxRequired: false,
    windowsCompatible: 'yes',
    notes: 'Point the Local Server provider at its llama-server port. No code change needed.',
  },
  {
    id: 'odysseus',
    slug: 'odysseus-dev/odysseus',
    url: 'https://github.com/odysseus-dev/odysseus',
    name: 'Odysseus',
    description: 'Local AI / model serving runtime layer.',
    layer: 'model',
    roleInAkansha: 'Alternative local serving backend via the custom provider type.',
    status: 'ADAPTER_READY',
    integrationMode: 'http',
    capabilitiesProvided: ['model.chat.local', 'model.serving'],
    permissions: ['NETWORK_ACCESS_LOCAL'],
    sandboxRequired: false,
    windowsCompatible: 'partial',
    notes: 'Reachable through the generic custom/openai-compatible provider if it exposes an OpenAI surface.',
  },
  {
    id: 'heretic',
    slug: 'p-e-w/heretic',
    url: 'https://github.com/p-e-w/heretic',
    name: 'Heretic',
    description: 'Experimental model modification / research system.',
    layer: 'model',
    roleInAkansha: 'Experimental model lab — produces candidate model artefacts for evaluation.',
    status: 'ADAPTER_READY',
    integrationMode: 'subprocess',
    capabilitiesProvided: ['model.experiment', 'model.artifact.build'],
    permissions: ['EXECUTE_COMMANDS', 'FILESYSTEM_WRITE'],
    sandboxRequired: true,
    windowsCompatible: 'partial',
    notes: 'Never a serving path. Output artefacts are benchmarked before any provider registration.',
  },
  {
    id: 'omniroute-a',
    slug: 'xmedook/omniroute',
    url: 'https://github.com/xmedook/omniroute',
    name: 'OmniRoute (xmedook)',
    description: 'AI gateway / model router with provider fallback and load balancing.',
    layer: 'model',
    roleInAkansha: 'Optional additional gateway beneath Akansha ModelRouter.',
    status: 'REFERENCE',
    integrationMode: 'concepts',
    capabilitiesProvided: ['routing.concepts'],
    permissions: [],
    sandboxRequired: false,
    windowsCompatible: 'n/a',
    fallbackFor: ['model-router'],
    notes: 'Akansha already owns routing. Adding a second router would create a competing brain — concepts only.',
  },
  {
    id: 'omniroute-b',
    slug: 'pitbaden/omniroute',
    url: 'https://github.com/pitbaden/omniroute',
    name: 'OmniRoute (pitbaden)',
    description: 'Alternative OmniRoute implementation for multi-provider routing.',
    layer: 'model',
    roleInAkansha: 'Second OmniRoute candidate — requires audit before any adoption.',
    status: 'REFERENCE',
    integrationMode: 'concepts',
    capabilitiesProvided: ['routing.concepts'],
    permissions: [],
    sandboxRequired: false,
    windowsCompatible: 'n/a',
    fallbackFor: ['model-router'],
    notes: 'Two same-named projects exist. Audit license, maintenance and activity before choosing either.',
  },
  {
    id: 'omlx',
    slug: 'jundot/omlx',
    url: 'https://github.com/jundot/omlx',
    name: 'oMLX',
    description: 'Local LLM inference infrastructure.',
    layer: 'model',
    roleInAkansha: 'Evaluated and excluded from the Windows runtime.',
    status: 'REJECTED',
    integrationMode: 'none',
    capabilitiesProvided: [],
    permissions: [],
    sandboxRequired: false,
    windowsCompatible: 'no',
    rejectionReason:
      'Primarily Apple Silicon / macOS. Unsuitable as a Windows production runtime. Ollama and llama.cpp cover local inference on Windows.',
    notes: 'Documented so the decision is auditable rather than silently skipped.',
  },

  /* ─────────────── MEMORY LAYER ─────────────── */
  {
    id: 'mem0',
    slug: 'mem0ai/mem0',
    url: 'https://github.com/mem0ai/mem0',
    name: 'Mem0',
    description: 'Persistent AI memory layer for extracting, storing and retrieving memories.',
    layer: 'memory',
    roleInAkansha: 'Optional memory provider behind MemoryIntelligence.',
    status: 'ADAPTER_READY',
    integrationMode: 'http',
    capabilitiesProvided: ['memory.extract', 'memory.store', 'memory.search'],
    permissions: ['NETWORK_ACCESS', 'MEMORY_WRITE'],
    sandboxRequired: false,
    windowsCompatible: 'yes',
    notes: 'Akansha keeps its own canonical memory model with scoring; Mem0 can serve as a backend store.',
  },
  {
    id: 'letta',
    slug: 'letta-ai/letta',
    url: 'https://github.com/letta-ai/letta',
    name: 'Letta',
    description: 'Stateful agents with persistent memory and long-running agent state.',
    layer: 'memory',
    roleInAkansha: 'Long-term agent-state persistence pattern for checkpointed missions.',
    status: 'ARCHITECTURAL',
    integrationMode: 'concepts',
    capabilitiesProvided: ['memory.agent-state', 'mission.checkpoint.pattern'],
    permissions: [],
    sandboxRequired: false,
    windowsCompatible: 'n/a',
    notes: 'Checkpoint/restore in AgentSupervisor follows this model. No runtime dependency.',
  },
  {
    id: 'tencentdb-agent-memory',
    slug: 'TencentCloud/TencentDB-Agent-Memory',
    url: 'https://github.com/TencentCloud/TencentDB-Agent-Memory',
    name: 'TencentDB Agent Memory',
    description: 'Agent memory / team knowledge system for persistent context.',
    layer: 'memory',
    roleInAkansha: 'Optional team-knowledge memory backend.',
    status: 'ADAPTER_READY',
    integrationMode: 'http',
    capabilitiesProvided: ['memory.team', 'memory.knowledge-base'],
    permissions: ['NETWORK_ACCESS', 'DATABASE_ACCESS'],
    sandboxRequired: false,
    windowsCompatible: 'yes',
    notes: 'Useful only if multi-user / team memory is required.',
  },
  {
    id: 'lifeos',
    slug: 'danielmiessler/LifeOS',
    url: 'https://github.com/danielmiessler/LifeOS',
    name: 'LifeOS',
    description: 'Personal knowledge / intent management around state, goals and desired outcomes.',
    layer: 'memory',
    roleInAkansha: 'Goal and intent-state modelling concepts.',
    status: 'REFERENCE',
    integrationMode: 'concepts',
    capabilitiesProvided: ['intent.goal-model'],
    permissions: [],
    sandboxRequired: false,
    windowsCompatible: 'n/a',
    notes: 'Informed the Goal/Intent Engine design. Not a runtime component.',
  },

  /* ─────────────── ORCHESTRATION / AGENT LAYER ─────────────── */
  {
    id: 'langgraph',
    slug: 'langchain-ai/langgraph',
    url: 'https://github.com/langchain-ai/langgraph',
    name: 'LangGraph',
    description: 'Stateful agent/workflow orchestration with durable execution and human-in-the-loop.',
    layer: 'orchestration',
    roleInAkansha: 'Durable mission-graph and human-in-the-loop approval patterns.',
    status: 'ARCHITECTURAL',
    integrationMode: 'concepts',
    capabilitiesProvided: ['mission.graph.pattern', 'mission.durable-execution'],
    permissions: [],
    sandboxRequired: false,
    windowsCompatible: 'n/a',
    notes: 'Master Orchestrator owns this. Introducing LangGraph at runtime would create a second brain.',
  },
  {
    id: 'brigade',
    slug: 'spinabot/brigade',
    url: 'https://github.com/spinabot/brigade',
    name: 'Brigade',
    description: 'Local agent ecosystem with agents, skills, memory, cron, subagents and connectors.',
    layer: 'orchestration',
    roleInAkansha: 'Selective agent/skill infrastructure and scheduled-work patterns.',
    status: 'ADAPTER_READY',
    integrationMode: 'adapter',
    capabilitiesProvided: ['agent.registry', 'skill.packaging', 'schedule.cron', 'connector.framework'],
    permissions: ['EXECUTE_COMMANDS', 'FILESYSTEM_READ'],
    sandboxRequired: true,
    windowsCompatible: 'partial',
    notes: 'Skill packaging and cron concepts are valuable; must not own orchestration.',
  },
  {
    id: 'deepseek-harness',
    slug: 'deepseek-ai/deepseek-harness',
    url: 'https://github.com/deepseek-ai/deepseek-harness',
    name: 'DeepSeek Harness',
    description: 'Agent harness for coordinating tools/plugins and agent workflows.',
    layer: 'orchestration',
    roleInAkansha: 'Agent harness reference for tool/plugin coordination.',
    status: 'REFERENCE',
    integrationMode: 'concepts',
    capabilitiesProvided: ['harness.pattern'],
    permissions: [],
    sandboxRequired: false,
    windowsCompatible: 'n/a',
    notes: 'Experimentation reference only.',
  },
  {
    id: 'paperclip',
    slug: 'paperclipai/paperclip',
    url: 'https://github.com/paperclipai/paperclip',
    name: 'Paperclip',
    description: 'Agent organisation/management platform for coordinating autonomous agents.',
    layer: 'orchestration',
    roleInAkansha: 'Agent-management and organisational-hierarchy concepts.',
    status: 'REFERENCE',
    integrationMode: 'concepts',
    capabilitiesProvided: ['agent.org-hierarchy'],
    permissions: [],
    sandboxRequired: false,
    windowsCompatible: 'n/a',
    notes: 'AgentSupervisor already covers lifecycle. Concepts only.',
  },

  /* ─────────────── BROWSER LAYER ─────────────── */
  {
    id: 'page-agent',
    slug: 'alibaba/page-agent',
    url: 'https://github.com/alibaba/page-agent',
    name: 'Alibaba Page Agent',
    description: 'Natural-language web-page / DOM interaction agent.',
    layer: 'browser',
    roleInAkansha: 'Level-1 DOM web interaction specialist with verification and escalation.',
    status: 'INTEGRATED',
    integrationMode: 'mcp',
    capabilitiesProvided: [
      'browser.page.read', 'browser.page.find', 'browser.page.click',
      'browser.page.type', 'browser.page.select', 'browser.page.submit',
      'browser.page.extract', 'browser.page.navigate', 'browser.page.verify',
    ],
    permissions: ['BROWSER_ACCESS', 'NETWORK_ACCESS'],
    sandboxRequired: true,
    windowsCompatible: 'yes',
    fallbackFor: ['browser-use', 'vision-agent'],
    notes: 'DOM-only by design. Escalates on canvas, iframe, CAPTCHA and OS dialogs.',
  },
  {
    id: 'browser-use',
    slug: 'browser-use/browser-use',
    url: 'https://github.com/browser-use/browser-use',
    name: 'Browser Use',
    description: 'AI-driven browser automation and navigation.',
    layer: 'browser',
    roleInAkansha: 'Level-3 browser automation engine in the escalation ladder.',
    status: 'ADAPTER_READY',
    integrationMode: 'sidecar',
    capabilitiesProvided: ['browser.automation', 'browser.multi-page', 'browser.navigate'],
    permissions: ['BROWSER_ACCESS', 'NETWORK_ACCESS'],
    sandboxRequired: true,
    windowsCompatible: 'yes',
    fallbackFor: ['page-agent'],
    notes: 'Preferred when DOM interaction fails or multi-page flows are required.',
  },

  /* ─────────────── COMPUTER-USE LAYER ─────────────── */
  {
    id: 'ui-tars',
    slug: 'bytedance/UI-TARS',
    url: 'https://github.com/bytedance/UI-TARS',
    name: 'UI-TARS',
    description: 'Vision-language computer-use model for operating graphical interfaces.',
    layer: 'computer-use',
    roleInAkansha: 'Vision-grounded GUI understanding for the computer-use tier.',
    status: 'ADAPTER_READY',
    integrationMode: 'http',
    capabilitiesProvided: ['vision.gui-understand', 'computer.use.plan'],
    permissions: ['SCREEN_CAPTURE', 'VISION_ACCESS'],
    sandboxRequired: false,
    windowsCompatible: 'yes',
    notes: 'Runs behind a vision-capable provider; never a direct orchestrator.',
  },
  {
    id: 'ui-tars-desktop',
    slug: 'bytedance/UI-TARS-desktop',
    url: 'https://github.com/bytedance/UI-TARS-desktop',
    name: 'UI-TARS Desktop',
    description: 'Desktop computer-use agent that visually understands GUIs and controls mouse/keyboard.',
    layer: 'computer-use',
    roleInAkansha: 'Level-6 computer-use execution provider.',
    status: 'ADAPTER_READY',
    integrationMode: 'sidecar',
    capabilitiesProvided: ['computer.use.execute', 'computer.mouse', 'computer.keyboard'],
    permissions: ['INPUT_CONTROL', 'SCREEN_CAPTURE', 'EXECUTE_COMMANDS'],
    sandboxRequired: true,
    windowsCompatible: 'yes',
    fallbackFor: ['windows-ui-automation'],
    notes: 'Highest-privilege tier. Every action requires explicit confirmation by policy.',
  },
  {
    id: 'open-interpreter',
    slug: 'OpenInterpreter/open-interpreter',
    url: 'https://github.com/OpenInterpreter/open-interpreter',
    name: 'Open Interpreter',
    description: 'Natural-language computer control via generated Python, JS and shell.',
    layer: 'computer-use',
    roleInAkansha: 'Sandboxed terminal/computer execution provider.',
    status: 'ADAPTER_READY',
    integrationMode: 'subprocess',
    capabilitiesProvided: ['terminal.execute', 'computer.script', 'file.manipulate'],
    permissions: ['EXECUTE_COMMANDS', 'FILESYSTEM_WRITE', 'PROCESS_SPAWN'],
    sandboxRequired: true,
    windowsCompatible: 'yes',
    notes: 'MUST be sandboxed. Generated code is never executed with host privileges.',
  },

  /* ─────────────── CODING LAYER ─────────────── */
  {
    id: 'openhands',
    slug: 'OpenHands/OpenHands',
    url: 'https://github.com/OpenHands/OpenHands',
    name: 'OpenHands',
    description: 'Autonomous software-development agent working with repos, terminals and dev tasks.',
    layer: 'coding',
    roleInAkansha: 'Primary long-running coding agent.',
    status: 'ADAPTER_READY',
    integrationMode: 'sidecar',
    capabilitiesProvided: ['coding.implement', 'coding.refactor', 'repo.inspect', 'test.run'],
    permissions: ['FILESYSTEM_READ', 'FILESYSTEM_WRITE', 'EXECUTE_COMMANDS', 'NETWORK_ACCESS'],
    sandboxRequired: true,
    windowsCompatible: 'partial',
    fallbackFor: ['orca'],
    notes: 'Used for large implementation tasks. Results are verified by tests, never by prose.',
  },
  {
    id: 'orca',
    slug: 'stablyai/orca',
    url: 'https://github.com/stablyai/orca',
    name: 'StablyAI Orca',
    description: 'Agentic coding, parallel development, worktrees, terminal and computer use.',
    layer: 'coding',
    roleInAkansha: 'Parallel coding / isolated worktree orchestration provider.',
    status: 'INTEGRATED',
    integrationMode: 'adapter',
    capabilitiesProvided: ['coding.parallel', 'git.worktree', 'terminal.session', 'agent.evaluate', 'code.review'],
    permissions: ['FILESYSTEM_READ', 'FILESYSTEM_WRITE', 'EXECUTE_COMMANDS'],
    sandboxRequired: true,
    windowsCompatible: 'yes',
    fallbackFor: ['openhands'],
    notes: 'Parallel agents are compared on test evidence, then merged selectively — never blindly.',
  },

  /* ─────────────── AVATAR / VOICE LAYER ─────────────── */
  {
    id: 'open-llm-vtuber',
    slug: 'Open-LLM-VTuber/Open-LLM-VTuber',
    url: 'https://github.com/Open-LLM-VTuber/Open-LLM-VTuber',
    name: 'Open-LLM-VTuber',
    description: 'LLM VTuber system: animated character presence, conversation and voice interaction.',
    layer: 'avatar',
    roleInAkansha: 'Avatar / voice-presence / character layer behind the renderer-neutral AvatarEngine.',
    status: 'INTEGRATED',
    integrationMode: 'adapter',
    capabilitiesProvided: ['avatar.presence', 'avatar.expression', 'avatar.lip-sync', 'voice.interrupt', 'voice.interaction'],
    permissions: ['AUDIO_ACCESS', 'SCREEN_RENDER'],
    sandboxRequired: false,
    windowsCompatible: 'yes',
    notes: 'Its model provider is adapted OUT — all intelligence flows through Akansha ModelRouter.',
  },
  {
    id: 'qwen-audio-agent',
    slug: 'QwenAudio/qwen-audio-agent',
    url: 'https://github.com/QwenAudio/qwen-audio-agent',
    name: 'Qwen Audio Agent',
    description: 'Audio/voice agent with audio understanding and conversational interaction.',
    layer: 'avatar',
    roleInAkansha: 'Audio-understanding provider for the voice pipeline.',
    status: 'ADAPTER_READY',
    integrationMode: 'http',
    capabilitiesProvided: ['audio.understand', 'voice.converse', 'asr.advanced'],
    permissions: ['AUDIO_ACCESS', 'NETWORK_ACCESS'],
    sandboxRequired: false,
    windowsCompatible: 'yes',
    notes: 'Sits behind the single SpeechOutputManager — it cannot create a second TTS stream.',
  },

  /* ─────────────── MCP FABRIC ─────────────── */
  {
    id: 'awesome-mcp-servers',
    slug: 'appcypher/awesome-mcp-servers',
    url: 'https://github.com/appcypher/awesome-mcp-servers',
    name: 'awesome-mcp-servers',
    description: 'Curated catalogue of MCP servers across filesystem, Git, cloud, DB, browser and more.',
    layer: 'mcp',
    roleInAkansha: 'MCP discovery catalogue — gated behind audit, sandbox and approval.',
    status: 'CATALOG',
    integrationMode: 'none',
    capabilitiesProvided: ['mcp.discovery'],
    permissions: [],
    sandboxRequired: true,
    windowsCompatible: 'n/a',
    notes:
      'Archived Aug 1 2026. The catalogue itself warns unsandboxed MCP servers can obtain host-level filesystem, network and system access. Never auto-installed.',
  },

  /* ─────────────── WORKSPACE / DESKTOP ─────────────── */
  {
    id: 'puter',
    slug: 'HeyPuter/puter',
    url: 'https://github.com/HeyPuter/puter',
    name: 'Puter',
    description: 'Self-hostable internet/cloud-computer: files, storage, apps, AI, workers.',
    layer: 'workspace',
    roleInAkansha: 'Optional cloud workspace / storage layer.',
    status: 'ADAPTER_READY',
    integrationMode: 'http',
    capabilitiesProvided: ['cloud.files', 'cloud.storage', 'cloud.apps', 'cloud.workers'],
    permissions: ['NETWORK_ACCESS', 'CLOUD_ACCESS'],
    sandboxRequired: false,
    windowsCompatible: 'yes',
    notes: 'Optional. Never replaces Akansha memory or orchestration.',
  },
  {
    id: 'berd',
    slug: 'block/berd',
    url: 'https://github.com/block/berd',
    name: 'Berd',
    description: 'Tauri + React desktop agent UI using an agent backend over ACP WebSocket.',
    layer: 'desktop',
    roleInAkansha: 'Desktop shell / ACP transport and Agent-Skills packaging reference.',
    status: 'REFERENCE',
    integrationMode: 'concepts',
    capabilitiesProvided: ['desktop.shell.pattern', 'acp.transport', 'skill.packaging'],
    permissions: [],
    sandboxRequired: false,
    windowsCompatible: 'yes',
    notes: 'Informs the Tauri desktop packaging plan and the ACP sidecar boundary.',
  },

  /* ─────────────── EVALUATION / REFERENCE ─────────────── */
  {
    id: 'osworld',
    slug: 'xlang-ai/osworld',
    url: 'https://github.com/xlang-ai/osworld',
    name: 'OSWorld',
    description: 'Benchmark/evaluation environment for multimodal computer-operating agents.',
    layer: 'evaluation',
    roleInAkansha: 'Computer-use evaluation benchmark — offline, not a runtime dependency.',
    status: 'CATALOG',
    integrationMode: 'none',
    capabilitiesProvided: ['eval.computer-use-benchmark'],
    permissions: [],
    sandboxRequired: true,
    windowsCompatible: 'no',
    notes: 'Used to score computer-use agents. Runs in CI, never in the live assistant.',
  },
  {
    id: 'awesome-llm-apps',
    slug: 'Shubhamsaboo/awesome-llm-apps',
    url: 'https://github.com/Shubhamsaboo/awesome-llm-apps',
    name: 'awesome-llm-apps',
    description: 'Large collection of LLM, RAG, agent, voice and self-improving app examples.',
    layer: 'reference',
    roleInAkansha: 'Feature and implementation research reference.',
    status: 'REFERENCE',
    integrationMode: 'none',
    capabilitiesProvided: [],
    permissions: [],
    sandboxRequired: false,
    windowsCompatible: 'n/a',
    notes: 'No runtime coupling.',
  },
  {
    id: 'openagent',
    slug: 'the-open-agent/openagent',
    url: 'https://github.com/the-open-agent/openagent',
    name: 'OpenAgent',
    description: 'Personal AI assistant with computer use, browser, coding, RAG/MCP and autonomous loops.',
    layer: 'reference',
    roleInAkansha: 'Architecture and feature reference.',
    status: 'REFERENCE',
    integrationMode: 'none',
    capabilitiesProvided: [],
    permissions: [],
    sandboxRequired: false,
    windowsCompatible: 'n/a',
    notes: 'No runtime coupling.',
  },
  {
    id: 'incredible-ai-agents',
    slug: 'ritchieng/the-incredible-ai-agents',
    url: 'https://github.com/ritchieng/the-incredible-ai-agents',
    name: 'The Incredible AI Agents',
    description: 'Curated catalogue of AI-agent projects and agent-lifecycle ideas.',
    layer: 'reference',
    roleInAkansha: 'Research / discovery catalogue.',
    status: 'REFERENCE',
    integrationMode: 'none',
    capabilitiesProvided: [],
    permissions: [],
    sandboxRequired: false,
    windowsCompatible: 'n/a',
    notes: 'No runtime coupling.',
  },
];

export interface LayerSummary {
  layer: RepositoryLayer;
  label: string;
  description: string;
  repositories: RepositoryEntry[];
  integrated: number;
  adapterReady: number;
  rejected: number;
}

const LAYER_META: Record<RepositoryLayer, { label: string; description: string }> = {
  model: { label: 'Model Intelligence', description: 'Local and cloud inference runtimes behind ModelRouter' },
  memory: { label: 'Memory', description: 'Persistent, episodic, semantic and agent-state memory' },
  orchestration: { label: 'Orchestration', description: 'Mission graphs, agent registries and scheduling patterns' },
  browser: { label: 'Browser', description: 'DOM, automation and multi-page web interaction' },
  'computer-use': { label: 'Computer Use', description: 'Vision GUI understanding and desktop input control' },
  coding: { label: 'Coding', description: 'Implementation agents, worktrees and evaluation' },
  avatar: { label: 'Avatar & Voice', description: 'Character presence, expression, lip-sync and audio' },
  mcp: { label: 'MCP Fabric', description: 'Model Context Protocol discovery and governance' },
  workspace: { label: 'Workspace', description: 'Optional cloud files, storage and apps' },
  desktop: { label: 'Desktop Shell', description: 'Windows packaging and agent transport boundaries' },
  evaluation: { label: 'Evaluation', description: 'Benchmarks that score agent capability offline' },
  reference: { label: 'Reference', description: 'Design references with zero runtime coupling' },
};

const LAYER_ORDER: RepositoryLayer[] = [
  'model', 'memory', 'orchestration', 'browser',
  'computer-use', 'coding', 'avatar', 'mcp',
  'workspace', 'desktop', 'evaluation', 'reference',
];

export class RepositoryRegistry {
  all(): RepositoryEntry[] {
    return REPOSITORIES;
  }

  byLayer(): LayerSummary[] {
    return LAYER_ORDER.map((layer) => {
      const repositories = REPOSITORIES.filter((r) => r.layer === layer);
      return {
        layer,
        label: LAYER_META[layer].label,
        description: LAYER_META[layer].description,
        repositories,
        integrated: repositories.filter((r) => r.status === 'INTEGRATED').length,
        adapterReady: repositories.filter((r) => r.status === 'ADAPTER_READY').length,
        rejected: repositories.filter((r) => r.status === 'REJECTED').length,
      };
    }).filter((l) => l.repositories.length > 0);
  }

  byStatus(status: IntegrationStatus): RepositoryEntry[] {
    return REPOSITORIES.filter((r) => r.status === status);
  }

  get(id: string): RepositoryEntry | undefined {
    return REPOSITORIES.find((r) => r.id === id);
  }

  /** Repos that can substitute for a given capability, in preference order. */
  fallbacksFor(capability: string): RepositoryEntry[] {
    return REPOSITORIES.filter((r) => r.fallbackFor?.includes(capability) && r.status !== 'REJECTED');
  }

  /** Repos whose integration demands a sandbox or high privilege. */
  securitySensitive(): RepositoryEntry[] {
    return REPOSITORIES.filter((r) => r.sandboxRequired || r.permissions.includes('EXECUTE_COMMANDS'));
  }

  /** Repos providing a specific capability string. */
  providersOf(capability: string): RepositoryEntry[] {
    return REPOSITORIES.filter((r) => r.capabilitiesProvided.includes(capability) && r.status !== 'REJECTED');
  }

  stats() {
    const byStatus = REPOSITORIES.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});
    return {
      total: REPOSITORIES.length,
      byStatus,
      integrated: byStatus.INTEGRATED || 0,
      adapterReady: byStatus.ADAPTER_READY || 0,
      rejected: byStatus.REJECTED || 0,
      layers: new Set(REPOSITORIES.map((r) => r.layer)).size,
      capabilities: new Set(REPOSITORIES.flatMap((r) => r.capabilitiesProvided)).size,
    };
  }

  /** Capability strings this registry can contribute to the live graph. */
  actionableCapabilities(): { repo: RepositoryEntry; capability: string }[] {
    return REPOSITORIES.filter((r) => r.status === 'INTEGRATED' || r.status === 'ADAPTER_READY')
      .flatMap((repo) => repo.capabilitiesProvided.map((capability) => ({ repo, capability })));
  }
}

export const repositoryRegistry = new RepositoryRegistry();
