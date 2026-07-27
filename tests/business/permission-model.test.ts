import { describe, it, expect } from "vitest";
import { extractPermissions, buildPermissionModel } from "../../src/business/permission-model.js";
import { extractBusinessActions } from "../../src/business/action-extractor.js";
import { buildSampleInventory } from "../fixtures/business.js";

describe("extractPermissions", () => {
  const inventory = buildSampleInventory();
  const actions = extractBusinessActions(inventory);
  const permissions = extractPermissions(inventory, actions);

  it("creates one permission node per action", () => {
    expect(permissions).toHaveLength(7);
  });

  it("grants admin-only for the cancel action", () => {
    const perm = permissions.find((p) => p.actionId === "ba:mod:orders:cancel");
    expect(perm).toBeDefined();
    expect(perm!.roleIds).toEqual(["role:admin"]);
    expect(perm!.effect).toBe("allow");
  });

  it("leaves public actions unrestricted", () => {
    const perm = permissions.find((p) => p.actionId === "ba:mod:orders:list");
    expect(perm!.roleIds).toEqual([]);
  });
});

describe("buildPermissionModel", () => {
  const inventory = buildSampleInventory();
  const actions = extractBusinessActions(inventory);
  const matrices = buildPermissionModel(inventory, actions);

  it("produces one matrix per module", () => {
    expect(matrices.map((m) => m.moduleId)).toEqual(["mod:orders", "mod:users"]);
  });

  it("computes allowed/denied role sets per action", () => {
    const orders = matrices.find((m) => m.moduleId === "mod:orders")!;
    const cancel = orders.entries.find((e) => e.actionId === "ba:mod:orders:cancel")!;
    expect(cancel.allowedRoleIds).toEqual(["role:admin"]);
    expect(cancel.deniedRoleIds.sort()).toEqual(["role:guest", "role:user"]);
  });
});
