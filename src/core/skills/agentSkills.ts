/**
 * Registers the vendored agent-skills methodology corpus into Akansha's EXISTING
 * SkillRegistry (no second registry). These are GUIDANCE skills — they carry no
 * provider/tool side effects, so providers/tools are empty and risk is low; the
 * full SKILL.md text is vendored under src/core/skills/library for an agent to
 * read on demand. This makes the methodologies (TDD, debugging, planning,
 * security-hardening, etc.) discoverable to the planner/agents.
 */
import { skillRegistry, type Skill } from './SkillRegistry';
import { AGENT_SKILLS } from './agentSkillsLibrary';

export function toSkill(def: { id: string; name: string; description: string }): Skill {
  return {
    id: `agent-skill:${def.id}`,
    name: def.name,
    description: def.description,
    version: '1.0.0',
    provider: 'methodology',
    providers: [],
    inputs: ['task context'],
    outputs: ['guidance'],
    tools: [],
    mcpServers: [],
    agents: [],
    requiredPermissions: [],
    riskLevel: 'low',
    dependencies: [],
    preconditions: [],
    successCriteria: ['guidance applied to the plan/execution'],
    failureModes: [],
    verification: 'methodology guidance — no side effects; not a runtime capability',
    latencyProfile: { min: 0, max: 0, typical: 0 },
    reliabilityProfile: 1,
    learningHistory: [],
    availability: 'available',
  };
}

/** Register all vendored skills; returns the count registered. Idempotent. */
export function registerAgentSkills(registry = skillRegistry): number {
  for (const def of AGENT_SKILLS) registry.register(toSkill(def));
  return AGENT_SKILLS.length;
}
