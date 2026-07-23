import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AiProvider } from './provider.js';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;

export interface FailureEvidence {
  testId: string;
  title: string;
  error: string;
  consoleErrors: string[];
  failedRequests: Array<{ method: string; url: string; status?: number; error?: string }>;
  screenshotDescriptions?: string[];
  recentChanges?: string[];
  screenshotPaths?: string[];
}

export interface FailureTriage {
  classification: 'product-defect' | 'test-defect' | 'environment' | 'data' | 'flaky' | 'unknown';
  confidence: number;
  summary: string;
  evidence: string[];
  suggestedNextSteps: string[];
  requiresHumanReview: boolean;
}

export async function triageFailureWithAi(
  provider: AiProvider,
  evidence: FailureEvidence,
  options: { maxContextChars?: number; additionalSecretKeys?: string[] } = {},
): Promise<FailureTriage> {
  const images = await loadEvidenceImages(evidence.screenshotPaths ?? []);
  const response = await provider.generateJson<FailureTriage>({
    task: 'Classify a failed browser test using only the supplied evidence.',
    instructions: [
      'Do not claim a root cause that is not supported by evidence.',
      'Use unknown and requiresHumanReview when evidence is insufficient.',
      'Do not recommend modifying production data or weakening assertions.',
    ].join('\n'),
    schemaName: 'FailureTriage',
    schemaDescription:
      '{ classification, confidence: number 0..1, summary, evidence: string[], suggestedNextSteps: string[], requiresHumanReview: boolean }',
    input: evidence,
    ...(options.maxContextChars === undefined ? {} : { maxContextChars: options.maxContextChars }),
    ...(options.additionalSecretKeys === undefined ? {} : { additionalSecretKeys: options.additionalSecretKeys }),
    ...(images.length > 0 ? { images } : {}),
  });

  const value = response.value;
  const classes = new Set(['product-defect', 'test-defect', 'environment', 'data', 'flaky', 'unknown']);
  if (!classes.has(value.classification)) throw new Error('AI triage returned an invalid classification.');
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new Error('AI triage returned invalid confidence.');
  }
  return value;
}

async function loadEvidenceImages(paths: string[]): Promise<Array<{ mimeType: string; dataBase64: string; description?: string }>> {
  const images: Array<{ mimeType: string; dataBase64: string; description?: string }> = [];
  let totalBytes = 0;
  for (const imagePath of paths.slice(0, 4)) {
    try {
      const data = await readFile(imagePath);
      if (data.byteLength > MAX_IMAGE_BYTES || totalBytes + data.byteLength > MAX_TOTAL_IMAGE_BYTES) continue;
      totalBytes += data.byteLength;
      const extension = path.extname(imagePath).toLowerCase();
      const mimeType = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png';
      images.push({ mimeType, dataBase64: data.toString('base64'), description: path.basename(imagePath) });
    } catch {
      // Missing evidence is reported through the textual context, not fatal to triage.
    }
  }
  return images;
}
