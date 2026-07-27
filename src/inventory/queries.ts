import type { Inventory, InventoryNode, TestScenario } from "../core/types.js";
import type { BusinessInventory } from "../business/types.js";
import { computeCoverage } from "./coverage.js";
import { computeBusinessGaps, computeBusinessCoverage } from "../business/gaps.js";
import { summarizeInventory } from "./summary.js";

/**
 * Phase 3 — read-only inventory query surface for agents and the CLI.
 *
 * This is the single safe entry point for asking questions about the inventory
 * (and, with `scenarios`, about coverage). It never mutates the inventory and
 * always returns plain JSON-friendly data. The available actions mirror the
 * plan's `inventory_query` capability.
 */

export type InventoryQueryAction = "summary" | "modules" | "module" | "page" | "relationships" | "gaps" | "business";

export interface InventoryQuery {
  action: InventoryQueryAction;
  /** Target node id for `module` / `page` actions. */
  id?: string;
  /** Optional catalog used to compute coverage and gaps. */
  scenarios?: readonly TestScenario[];
}

export interface InventoryQueryOptions {
  businessInventory?: BusinessInventory;
}

export function queryInventory(query: InventoryQuery, inventory: Inventory, options: InventoryQueryOptions = {}): unknown {
  switch (query.action) {
    case "summary": {
      const scenarios = query.scenarios;
      const summary = summarizeInventory(inventory, scenarios);
      return {
        ...summary,
        coverage: computeCoverage(inventory, scenarios ?? []),
      };
    }
    case "modules":
      return { modules: modules(inventory) };
    case "module":
      return requireNode(inventory, query.id, "module");
    case "page":
      return requireNode(inventory, query.id, "page");
    case "relationships":
      return { edges: inventory.edges };
    case "gaps":
      return { gaps: computeCoverage(inventory, query.scenarios ?? []).gaps };
    case "business": {
      if (!options.businessInventory) {
        throw new TypeError("The 'business' query requires a businessInventory option.");
      }
      return {
        coverage: computeBusinessCoverage(inventory, options.businessInventory),
        gaps: computeBusinessGaps(inventory, options.businessInventory),
      };
    }
    default:
      throw new TypeError(`Unknown inventory query action: ${(query as InventoryQuery).action}`);
  }
}

function modules(inventory: Inventory): Array<{ id: string; name: string; routeIds: string[]; apiIds: string[] }> {
  return inventory.nodes
    .filter((node): node is InventoryNode & { kind: "module" } => node.kind === "module")
    .map((node) => ({ id: node.id, name: node.name, routeIds: node.routeIds, apiIds: node.apiIds }));
}

function requireNode(inventory: Inventory, id: string | undefined, kind: InventoryNode["kind"]): InventoryNode {
  if (!id) throw new TypeError(`The '${kind}' query requires an 'id'.`);
  const node = inventory.nodes.find((candidate) => candidate.id === id && candidate.kind === kind);
  if (!node) throw new TypeError(`No ${kind} node found with id '${id}'.`);
  return node;
}
