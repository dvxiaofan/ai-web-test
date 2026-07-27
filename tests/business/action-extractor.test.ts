import { describe, it, expect } from "vitest";
import { extractBusinessActions, inferVerb } from "../../src/business/action-extractor.js";
import { buildSampleInventory } from "../fixtures/business.js";

describe("inferVerb", () => {
  it("maps HTTP method + path to a business verb", () => {
    expect(inferVerb("GET", "/orders")).toBe("list");
    expect(inferVerb("GET", "/orders/:id")).toBe("read");
    expect(inferVerb("POST", "/orders")).toBe("create");
    expect(inferVerb("POST", "/orders/123/cancel")).toBe("cancel");
    expect(inferVerb("POST", "/orders/123/approve")).toBe("approve");
    expect(inferVerb("POST", "/orders/123/submit")).toBe("submit");
    expect(inferVerb("PUT", "/orders/123")).toBe("update");
    expect(inferVerb("PATCH", "/orders/123")).toBe("update");
    expect(inferVerb("DELETE", "/orders/123")).toBe("delete");
  });
});

describe("extractBusinessActions", () => {
  const inventory = buildSampleInventory();
  const actions = extractBusinessActions(inventory);

  it("derives one business action per (module, verb) group", () => {
    expect(actions).toHaveLength(7);
  });

  it("creates a 'create order' action with route/page/role references", () => {
    const create = actions.find((a) => a.name === "create order");
    expect(create).toBeDefined();
    expect(create!.moduleId).toBe("mod:orders");
    expect(create!.verbs).toContain("create");
    expect(create!.routeIds).toContain("rt:orders:create");
    expect(create!.pageIds).toContain("pg:orders:new");
    expect(create!.requiredRoleIds.sort()).toEqual(["role:admin", "role:user"]);
  });

  it("marks public list routes with no required roles", () => {
    const list = actions.find((a) => a.name === "list order");
    expect(list).toBeDefined();
    expect(list!.routeIds).toContain("rt:orders:list");
    expect(list!.requiredRoleIds).toEqual([]);
  });

  it("restricts cancel to admin only", () => {
    const cancel = actions.find((a) => a.name === "cancel order");
    expect(cancel).toBeDefined();
    expect(cancel!.routeIds).toEqual(["rt:orders:cancel"]);
    expect(cancel!.requiredRoleIds).toEqual(["role:admin"]);
  });

  it("produces deterministic ids", () => {
    const ids = actions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(actions.find((a) => a.id === "ba:mod:orders:create")).toBeDefined();
  });
});
