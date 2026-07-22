import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { discoverSource } from "../../src/discovery/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("discoverSource", () => {
  it("returns raw discovery detail and a planner-compatible inventory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-web-test-project-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src", "features", "orders"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "orders-app",
      packageManager: "pnpm@10.0.0",
      dependencies: { react: "^19.0.0", "react-router-dom": "^7.0.0", axios: "^1.0.0" },
    }));
    await writeFile(path.join(root, "src", "features", "orders", "router.tsx"), `
      import axios from 'axios';
      export const routes = [{ path: '/orders', component: Orders, meta: { role: 'admin' } }];
      export const loadOrders = () => axios.get('/api/orders');
    `);
    await writeFile(path.join(root, "src", "features", "orders", "Orders.tsx"), `
      export function Orders() { return <button>Refresh</button>; }
    `);

    const result = await discoverSource({
      rootDir: root,
      baseUrl: "http://127.0.0.1:3000",
      now: new Date("2026-07-23T00:00:00.000Z"),
    });

    expect(result.framework.framework).toBe("react");
    expect(result.packageManager).toEqual(expect.objectContaining({ packageManager: "pnpm", version: "10.0.0" }));
    expect(result.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "/orders", moduleName: "orders", roles: ["admin"] }),
    ]));
    expect(result.apiOperations).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "GET", urlPattern: "/api/orders", moduleName: "orders" }),
    ]));
    expect(result.inventory.schemaVersion).toBe(1);
    expect(result.inventory.generatedAt).toBe("2026-07-23T00:00:00.000Z");
    expect(result.inventory.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "project", name: "orders-app" }),
      expect.objectContaining({ kind: "module", name: "orders" }),
      expect.objectContaining({ kind: "route", path: "/orders", requiresAuth: true }),
      expect.objectContaining({ kind: "api", method: "GET", urlPattern: "/api/orders" }),
      expect.objectContaining({ kind: "role", roleKey: "admin" }),
    ]));
    expect(result.inventory.coverage.routes.discovered).toBe(1);
    expect(result.inventory.runtimeBaseUrl).toBe("http://127.0.0.1:3000");
  });
});
