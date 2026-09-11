export interface Capability {
  id: string;
  name: string;
  description: string;
  category: 'native' | 'mcp' | 'agent' | 'api' | 'vision' | 'memory' | 'system';
  permissions: string[];
  requiredCapabilities: string[];
  inputSchema?: string;
  outputSchema?: string;
  latencyEstimateMs: number;
  reliabilityScore: number; // 0-1
  costEstimate: 'low' | 'medium' | 'high';
  available: boolean;
  mcpServerId?: string;
  toolName?: string;
}
