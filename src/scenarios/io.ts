import { readJsonFile, writeJsonFile, type TestScenario } from '../core/index.js';

export async function loadScenarios(filePath: string): Promise<TestScenario[]> {
  const value = await readJsonFile<unknown>(filePath);
  const candidates = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.scenarios)
      ? value.scenarios
      : undefined;
  if (!candidates) throw new Error(`Scenario file ${filePath} must contain an array or { scenarios: [] }.`);
  return candidates.map((candidate, index) => validateScenario(candidate, `${filePath}[${index}]`));
}

export async function writeScenarios(filePath: string, scenarios: TestScenario[]): Promise<void> {
  await writeJsonFile(filePath, { schemaVersion: 1, generatedAt: new Date().toISOString(), scenarios });
}

function validateScenario(value: unknown, location: string): TestScenario {
  if (!isRecord(value)) throw new Error(`Invalid scenario at ${location}: expected an object.`);
  if (value.schemaVersion !== 1 || typeof value.id !== 'string' || typeof value.name !== 'string') {
    throw new Error(`Invalid scenario at ${location}: schemaVersion, id, and name are required.`);
  }
  if (!Array.isArray(value.steps) || value.steps.some((step) => !isRecord(step) || typeof step.id !== 'string' || typeof step.action !== 'string')) {
    throw new Error(`Invalid scenario at ${location}: every step requires id and action.`);
  }
  return value as unknown as TestScenario;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
