import { describe, it, expect } from "vitest";
import { buildBusinessInventory } from "../../src/business/assemble.js";
import { buildBusinessModuleViews } from "../../src/business/module-builder.js";
import { buildSampleInventory } from "../fixtures/business.js";

describe("buildBusinessModuleViews", () => {
  const inventory = buildSampleInventory();
  const business = buildBusinessInventory(inventory);
  const views = buildBusinessModuleViews(inventory, business);
  const orders = views.find((v) => v.moduleId === "mod:orders")!;

  it("produces one view per module in the inventory", () => {
    expect(views.map((v) => v.moduleId).sort()).toEqual(["mod:orders", "mod:users"]);
  });

  it("aggregates actions, rules and permissions for a module", () => {
    expect(orders.actions).toHaveLength(5);
    expect(orders.rules).toHaveLength(5);
    expect(orders.permissions).toHaveLength(5);
    expect(orders.states).toHaveLength(0);
    expect(orders.entities).toHaveLength(0);
  });

  it("links rule ids back onto the matching action", () => {
    const create = orders.actions.find((a) => a.name === "create order")!;
    expect(create.ruleIds).toContain("br:rt:orders:create:role");
  });

  it("uses the inventory module name", () => {
    expect(orders.moduleName).toBe("orders");
  });
});
