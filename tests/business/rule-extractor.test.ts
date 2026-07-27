import { describe, it, expect } from "vitest";
import { extractBusinessRules } from "../../src/business/rule-extractor.js";
import { buildSampleInventory } from "../fixtures/business.js";

describe("extractBusinessRules", () => {
  const inventory = buildSampleInventory();
  const rules = extractBusinessRules(inventory);

  it("derives one rule per route", () => {
    expect(rules).toHaveLength(7);
  });

  it("emits an info-level public rule for unauthenticated routes", () => {
    const pub = rules.find((r) => r.id === "br:rt:orders:list:public");
    expect(pub).toBeDefined();
    expect(pub!.severity).toBe("info");
    expect(pub!.scope).toBe("action");
    expect(pub!.appliesTo).toContain("ba:mod:orders:list");
  });

  it("emits a warn-level role-restricted rule for authenticated routes", () => {
    const role = rules.find((r) => r.id === "br:rt:orders:create:role");
    expect(role).toBeDefined();
    expect(role!.severity).toBe("warn");
    expect(role!.description).toContain("user");
    expect(role!.description).toContain("admin");
    expect(role!.appliesTo).toContain("ba:mod:orders:create");
  });

  it("marks every role rule with action scope", () => {
    const roleRules = rules.filter((r) => r.id.endsWith(":role"));
    expect(roleRules.length).toBe(6);
    expect(roleRules.every((r) => r.scope === "action")).toBe(true);
  });
});
