import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentError, buildErrorEnvelope, buildSuccessEnvelope, isAgentResponse, normalizeAgentError } from "../../src/agent/index.js";
import { ConfigValidationError } from "../../src/core/index.js";
import { CliOutput } from "../../src/cli/output.js";

function captureStd() {
  const out: string[] = [];
  const err: string[] = [];
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
  return { out, err, outSpy, errSpy, stdout: () => out.join(""), stderr: () => err.join("") };
}

describe("agent protocol: error normalization", () => {
  it("maps ConfigValidationError to CONFIG_VALIDATION, not retryable", () => {
    const detail = normalizeAgentError(new ConfigValidationError([{ path: "x", code: "type", message: "bad" }]));
    expect(detail.code).toBe("CONFIG_VALIDATION");
    expect(detail.retryable).toBe(false);
    expect(typeof detail.message).toBe("string");
  });

  it("preserves AgentError code and retryable", () => {
    const detail = normalizeAgentError(new AgentError("PLAN_NOT_FOUND", "missing", true));
    expect(detail).toEqual({ code: "PLAN_NOT_FOUND", message: "missing", retryable: true });
  });

  it("maps plain Error to INTERNAL_ERROR", () => {
    const detail = normalizeAgentError(new Error("boom"));
    expect(detail.code).toBe("INTERNAL_ERROR");
    expect(detail.retryable).toBe(false);
  });

  it("maps unknown values to UNKNOWN_ERROR", () => {
    const detail = normalizeAgentError("weird");
    expect(detail.code).toBe("UNKNOWN_ERROR");
    expect(detail.retryable).toBe(false);
  });
});

describe("agent protocol: envelope builders", () => {
  it("success envelope always carries ok/warnings/nextActions and merges payload", () => {
    const env = buildSuccessEnvelope({ planId: "p1" }, ["careful"]);
    expect(env.ok).toBe(true);
    expect(env.warnings).toEqual(["careful"]);
    expect(env.nextActions).toEqual([]);
    expect(env.planId).toBe("p1");
  });

  it("success envelope forces ok:true and keeps the payload", () => {
    const env = buildSuccessEnvelope({ ok: false, status: "failed" }, []);
    expect(env.ok).toBe(true);
    expect(env.status).toBe("failed");
  });

  it("error envelope carries code/message/retryable", () => {
    const env = buildErrorEnvelope({ code: "X", message: "m", retryable: true });
    expect(env.ok).toBe(false);
    expect(env.error).toEqual({ code: "X", message: "m", retryable: true });
  });

  it("isAgentResponse validates envelope shape", () => {
    expect(isAgentResponse(buildSuccessEnvelope({ a: 1 }, []))).toBe(true);
    expect(isAgentResponse(buildErrorEnvelope({ code: "X", message: "m", retryable: false }))).toBe(true);
    expect(isAgentResponse({ ok: true })).toBe(false); // missing warnings/nextActions
    expect(isAgentResponse("nope")).toBe(false);
    expect(isAgentResponse({ ok: false })).toBe(false); // ok:false without error
  });
});

describe("CliOutput JSON protocol", () => {
  let cap: ReturnType<typeof captureStd>;
  beforeEach(() => {
    cap = captureStd();
  });
  afterEach(() => {
    cap.outSpy.mockRestore();
    cap.errSpy.mockRestore();
  });

  it("emits a single JSON envelope on stdout with warnings/nextActions", () => {
    const out = new CliOutput({ json: true, quiet: false });
    out.result({ planPath: "plans/p.json" });
    const parsed = JSON.parse(cap.stdout());
    expect(parsed.ok).toBe(true);
    expect(parsed.planPath).toBe("plans/p.json");
    expect(parsed.warnings).toEqual([]);
    expect(Array.isArray(parsed.nextActions)).toBe(true);
    expect(cap.stderr()).toBe(""); // stdout stays clean; logs go to stderr
  });

  it("collects warnings into the envelope", () => {
    const out = new CliOutput({ json: true, quiet: false });
    out.warn("use --yes");
    out.result({ planPath: "p.json" });
    const parsed = JSON.parse(cap.stdout());
    expect(parsed.warnings).toEqual(["use --yes"]);
  });

  it("writes error envelope with stable code and retryable to stderr", () => {
    const out = new CliOutput({ json: true, quiet: false });
    out.error(new AgentError("PLAN_NOT_FOUND", "no plan", true));
    expect(cap.stdout()).toBe(""); // errors never pollute stdout
    const parsed = JSON.parse(cap.stderr());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("PLAN_NOT_FOUND");
    expect(parsed.error.retryable).toBe(true);
  });

  it("routes info logs to stderr in JSON mode", () => {
    const out = new CliOutput({ json: true, quiet: false });
    out.info("progress");
    expect(cap.stdout()).toBe("");
    expect(cap.stderr()).toContain("progress");
  });

  it("in human mode, result object is not written to stdout (legacy behavior)", () => {
    cap.outSpy.mockRestore();
    const human = captureStd();
    const out = new CliOutput({ json: false, quiet: false });
    out.result({ planPath: "p.json" });
    expect(human.stdout()).toBe("");
    human.outSpy.mockRestore();
    human.errSpy.mockRestore();
  });
});
