import type { AiProvider } from './provider.js';

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
