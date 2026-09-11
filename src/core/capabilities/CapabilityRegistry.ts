import type { Capability } from './CapabilityGraph';

export class CapabilityGraph {
  private capabilities = new Map<string, Capability>();

  register(cap: Capability) {
    this.capabilities.set(cap.id, cap);
  }

  findByCategory(category: Capability['category']) {
    return Array.from(this.capabilities.values()).filter(
      (c) => c.category === category
    );
  }

  findByName(name: string) {
    return Array.from(this.capabilities.values()).find(
      (c) => c.name.toLowerCase() === name.toLowerCase()
    );
  }

  discoverAvailable() {
    return Array.from(this.capabilities.values()).filter(
      (c) => c.available
    );
  }

  discoverForGoal(goalType: string, requiredPermission?: string) {
    const available = this.discoverAvailable();
    return available.filter((c) => {
      if (requiredPermission && !c.permissions.includes(requiredPermission)) {
        return false;
      }
      return c.category !== 'system' || true;
    });
  }

  getAll(): Capability[] {
    return Array.from(this.capabilities.values());
  }

  unregister(id: string) {
    this.capabilities.delete(id);
  }

  get(id: string): Capability | undefined {
    return this.capabilities.get(id);
  }
}

export const capabilityGraph = new CapabilityGraph();
