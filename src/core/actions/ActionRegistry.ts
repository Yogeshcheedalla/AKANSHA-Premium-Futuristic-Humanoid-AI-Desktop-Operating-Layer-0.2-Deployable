import type { ActionContract } from './types';

/** Single authoritative action registry. Capabilities register a contract here;
 *  the dispatcher executes them. Not a second orchestrator — it holds contracts only. */
export class ActionRegistry {
  private contracts = new Map<string, ActionContract>();
  register(contract: ActionContract): this { this.contracts.set(contract.actionId, contract); return this; }
  get(actionId: string): ActionContract | undefined { return this.contracts.get(actionId); }
  has(actionId: string): boolean { return this.contracts.has(actionId); }
  list(): ActionContract[] { return [...this.contracts.values()]; }
  clear(): void { this.contracts.clear(); }
}

export const actionRegistry = new ActionRegistry();
