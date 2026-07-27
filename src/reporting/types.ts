export interface ReportCoverageDimension {
  name: string;
  discovered: number;
  covered: number;
  blocked?: number;
  excluded?: number;
}

export interface ReportTestResult {
  id: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'blocked';
  durationMs?: number;
  module?: string;
  route?: string;
  role?: string;
  error?: string;
  screenshot?: string;
  trace?: string;
  observations?: string[];
}

import type { BusinessCoverageReport } from "../business/types.js";

export interface HtmlReportModel {
  projectName: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  planId: string;
  planDigest?: string;
  environment?: string;
  summary: {
    passed: number;
    failed: number;
    skipped: number;
    blocked: number;
  };
  coverage: ReportCoverageDimension[];
  results: ReportTestResult[];
  warnings: string[];
  uncovered: string[];
  business?: BusinessCoverageReport;
}
