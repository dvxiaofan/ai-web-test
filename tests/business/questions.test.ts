import { describe, it, expect } from "vitest";
import { buildSampleInventory } from "../fixtures/business.js";
import { buildBusinessInventory } from "../../src/business/assemble.js";
import { computeBusinessGaps } from "../../src/business/gaps.js";
import { collectBusinessQuestions } from "../../src/business/questions.js";

describe("collectBusinessQuestions", () => {
  const inventory = buildSampleInventory();
  const business = buildBusinessInventory(inventory);
  const gaps = computeBusinessGaps(inventory, business);
  const questions = collectBusinessQuestions(gaps);

  it("produces one question per gap", () => {
    expect(questions).toHaveLength(gaps.length);
  });

  it("assigns priority by severity", () => {
    const guest = questions.find((q) => q.id === "bq:role-without-permission:role:guest");
    expect(guest).toBeDefined();
    expect(guest!.priority).toBe("low");
    expect(guest!.question).toContain("guest");
  });

  it("derives stable, content-addressed ids", () => {
    const ids = questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
