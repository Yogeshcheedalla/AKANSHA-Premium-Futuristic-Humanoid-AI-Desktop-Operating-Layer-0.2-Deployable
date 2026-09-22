import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SkillRegistry } from './SkillRegistry';
import { registerAgentSkills, toSkill } from './agentSkills';
import { AGENT_SKILLS } from './agentSkillsLibrary';

test('vendored agent-skills manifest has real names + descriptions', () => {
  assert.ok(AGENT_SKILLS.length >= 20);
  const tdd = AGENT_SKILLS.find((s) => s.id === 'test-driven-development');
  assert.ok(tdd && tdd.description.length > 20, 'expected a real description');
});

test('registerAgentSkills loads the corpus into the existing SkillRegistry (idempotent)', () => {
  const reg = new SkillRegistry();
  const n = registerAgentSkills(reg);
  assert.equal(n, AGENT_SKILLS.length);
  const tdd = reg.get('agent-skill:test-driven-development');
  assert.ok(tdd);
  assert.equal(tdd!.riskLevel, 'low');
  assert.deepEqual(tdd!.providers, []); // honest: guidance, no provider side effects
  // Idempotent re-register does not error and keeps one entry.
  registerAgentSkills(reg);
  assert.equal(reg.get('agent-skill:test-driven-development')?.id, 'agent-skill:test-driven-development');
});

test('toSkill produces a valid Skill shape', () => {
  const s = toSkill({ id: 'x', name: 'X', description: 'does x' });
  assert.equal(s.id, 'agent-skill:x');
  assert.equal(s.availability, 'available');
  assert.ok(s.verification.length > 0);
});
