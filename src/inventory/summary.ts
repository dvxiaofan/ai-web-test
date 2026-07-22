import type { Inventory, InventoryNode, TestScenario } from '../core/index.js';

export interface InventorySummary {
  project: string;
  framework: string;
  packageManager: string;
  counts: Record<InventoryNode['kind'], number>;
  modules: Array<{ id: string; name: string; routes: number; apis: number }>;
  coverage: Inventory['coverage'];
  findings: { open: number; highOrCritical: number };
  scenarios?: { total: number; readOnly: number; mutating: number; destructive: number };
}

export function summarizeInventory(inventory: Inventory, scenarios?: TestScenario[]): InventorySummary {
  const kinds: InventoryNode['kind'][] = ['project', 'module', 'route', 'page', 'component', 'api', 'role', 'scenario', 'store', 'guard', 'test'];
  const counts = Object.fromEntries(kinds.map((kind) => [kind, inventory.nodes.filter((node) => node.kind === kind).length])) as Record<InventoryNode['kind'], number>;
  const summary: InventorySummary = {
    project: inventory.project.name,
    framework: inventory.project.framework ?? 'unknown',
    packageManager: inventory.project.packageManager ?? 'unknown',
    counts,
    modules: inventory.nodes.filter((node) => node.kind === 'module').map((node) => ({
      id: node.id,
      name: node.name,
      routes: node.routeIds.length,
      apis: node.apiIds.length,
    })),
    coverage: inventory.coverage,
    findings: {
      open: inventory.findings.filter((finding) => finding.status === 'open').length,
      highOrCritical: inventory.findings.filter((finding) => finding.status === 'open' && ['high', 'critical'].includes(finding.severity)).length,
    },
  };
  if (scenarios) {
    summary.scenarios = {
      total: scenarios.length,
      readOnly: scenarios.filter((scenario) => scenario.risk === 'read').length,
      mutating: scenarios.filter((scenario) => scenario.risk === 'mutate').length,
      destructive: scenarios.filter((scenario) => scenario.risk === 'destructive').length,
    };
  }
  return summary;
}
