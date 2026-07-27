import type { AiProvider } from './provider.js';
import type { Inventory } from '../core/index.js';
import type {
  BusinessInventory,
  BusinessActionNode,
  PermissionNode,
  StateTransitionNode,
} from '../business/types.js';

export interface AiInventorySummary {
  project: string;
  modules: Array<{ id: string; name: string }>;
  routes: Array<{ id: string; path: string; moduleId?: string; confidence?: number }>;
  apis: Array<{ id: string; method?: string; path: string; moduleId?: string }>;
  pages?: Array<{ id: string; name: string; routes: string[]; controls?: unknown; links?: unknown }>;
  existingScenarios?: Array<{ id: string; name: string }>;
  gaps?: string[];
  /** Optional, explicitly requested source excerpts (never included by default). */
  sourceExcerpts?: Array<{ filePath: string; line?: number; content: string }>;
}

export interface AiScenarioProposal {
  name: string;
  description: string;
  moduleId?: string;
  routeIds: string[];
  apiIds: string[];
  tags: string[];
  risk: 'read' | 'mutate' | 'destructive';
  confidence: number;
  assumptions: string[];
  steps: Array<{
    action: string;
    target?: string;
    value?: string;
    assertion?: string;
    risk: 'read' | 'mutate' | 'destructive';
  }>;
}

export interface AiScenarioPlanResponse {
  scenarios: AiScenarioProposal[];
  coverageGaps: string[];
  questionsForOperator: string[];
}

export async function proposeScenariosWithAi(
  provider: AiProvider,
  inventory: AiInventorySummary,
  options: { maxContextChars?: number; additionalSecretKeys?: string[] } = {},
): Promise<AiScenarioPlanResponse> {
  const response = await provider.generateJson<AiScenarioPlanResponse>({
    task: 'Propose auditable browser test scenarios for the discovered application inventory.',
    instructions: [
      'Reference only route and API identifiers present in the input.',
      'Separate observed facts from assumptions.',
      'Give every action an explicit risk level.',
      'Prefer a small critical scenario set plus clearly listed coverage gaps.',
    ].join('\n'),
    schemaName: 'AiScenarioPlanResponse',
    schemaDescription:
      '{ scenarios: AiScenarioProposal[], coverageGaps: string[], questionsForOperator: string[] }',
    input: inventory,
    ...(options.maxContextChars === undefined ? {} : { maxContextChars: options.maxContextChars }),
    ...(options.additionalSecretKeys === undefined ? {} : { additionalSecretKeys: options.additionalSecretKeys }),
  });

  return validateScenarioPlan(response.value, inventory);
}

function validateScenarioPlan(
  value: AiScenarioPlanResponse,
  inventory: AiInventorySummary,
): AiScenarioPlanResponse {
  if (!value || !Array.isArray(value.scenarios)) throw new Error('AI scenario plan has no scenarios array.');
  const routeIds = new Set(inventory.routes.map((route) => route.id));
  const apiIds = new Set(inventory.apis.map((api) => api.id));
  const risks = new Set(['read', 'mutate', 'destructive']);

  for (const scenario of value.scenarios) {
    if (!scenario.name || !Array.isArray(scenario.steps)) throw new Error('AI scenario is missing name or steps.');
    if (!risks.has(scenario.risk)) throw new Error(`Invalid risk for AI scenario ${scenario.name}.`);
    if (scenario.routeIds.some((id) => !routeIds.has(id))) {
      throw new Error(`AI scenario ${scenario.name} references an unknown route.`);
    }
    if (scenario.apiIds.some((id) => !apiIds.has(id))) {
      throw new Error(`AI scenario ${scenario.name} references an unknown API.`);
    }
    if (!Number.isFinite(scenario.confidence) || scenario.confidence < 0 || scenario.confidence > 1) {
      throw new Error(`AI scenario ${scenario.name} has invalid confidence.`);
    }
    for (const step of scenario.steps) {
      if (!step.action || !risks.has(step.risk)) throw new Error(`AI scenario ${scenario.name} has an invalid step.`);
    }
  }

  return {
    scenarios: value.scenarios,
    coverageGaps: Array.isArray(value.coverageGaps) ? value.coverageGaps : [],
    questionsForOperator: Array.isArray(value.questionsForOperator) ? value.questionsForOperator : [],
  };
}

/**
 * Phase 4 — 由 Business Inventory 确定性地推导业务场景提案（不依赖 AI）。
 * - 对每个受限权限（roleIds 非空），为被拒绝的角色生成「拒绝访问」反向场景；
 * - 对每条状态迁移，生成「执行动作并断言状态变化」场景。
 * 返回的提案可经现有校验/导入流程进入场景目录。
 */
export function proposeBusinessScenarios(inventory: Inventory, business: BusinessInventory): AiScenarioProposal[] {
  const nodes = Object.values(business.nodes);
  const actions = nodes.filter((n): n is BusinessActionNode => n.kind === "business-action");
  const permissions = nodes.filter((n): n is PermissionNode => n.kind === "permission");
  const transitions = nodes.filter((n): n is StateTransitionNode => n.kind === "state-transition");

  const roleName = (roleId: string): string => {
    const role = inventory.nodes.find((n) => n.kind === "role" && n.id === roleId);
    return role && "name" in role ? role.name : roleId;
  };
  const allRoles = inventory.nodes.filter((n) => n.kind === "role").map((n) => n.id);

  const proposals: AiScenarioProposal[] = [];

  for (const perm of permissions) {
    if (perm.roleIds.length === 0) continue; // 无限制则无反向拒绝场景
    const action = actions.find((a) => a.id === perm.actionId);
    if (!action) continue;
    const denied = allRoles.filter((r) => !perm.roleIds.includes(r));
    for (const roleId of denied) {
      proposals.push({
        name: `拒绝 ${roleName(roleId)} 执行 ${action.name}`,
        description: `验证角色 ${roleName(roleId)} 无权执行 ${action.name}`,
        moduleId: action.moduleId,
        routeIds: action.routeIds,
        apiIds: [],
        tags: ["business", "permission", "negative"],
        risk: "mutate",
        confidence: 0.7,
        assumptions: [`${action.name} 受权限 ${perm.id} 保护`],
        steps: [
          { action: "navigate", target: action.routeIds[0] ?? "", risk: "read" },
          { action: "assertDenied", risk: "mutate" },
        ],
      });
    }
  }

  for (const t of transitions) {
    const action = actions.find((a) => a.id === t.actionId);
    if (!action) continue;
    proposals.push({
      name: `状态迁移 ${t.name}`,
      description: `执行 ${action.name} 验证状态从 ${t.fromStateId} 变为 ${t.toStateId}`,
      moduleId: t.moduleId,
      routeIds: action.routeIds,
      apiIds: [],
      tags: ["business", "state-transition"],
      risk: "mutate",
      confidence: 0.7,
      assumptions: ["状态机模型准确"],
      steps: [
        { action: "navigate", target: action.routeIds[0] ?? "", risk: "read" },
        { action: "perform", target: action.name, risk: "mutate" },
        { action: "assertState", value: t.toStateId, risk: "read" },
      ],
    });
  }

  return proposals;
}
