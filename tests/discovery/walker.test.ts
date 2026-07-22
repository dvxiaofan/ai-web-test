import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { walkSourceFiles } from "../../src/discovery/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("walkSourceFiles", () => {
  it("walks supported source files deterministically and ignores build output", async () => {
    const root = await temporaryDirectory();
    await mkdir(path.join(root, "src", "features", "orders"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "ignored"), { recursive: true });
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, "src", "features", "orders", "page.tsx"), "export default () => null");
    await writeFile(path.join(root, "src", "notes.md"), "not source");
    await writeFile(path.join(root, "node_modules", "ignored", "index.js"), "throw new Error('ignored')");
    await writeFile(path.join(root, "dist", "bundle.js"), "minified");

    const result = await walkSourceFiles({ rootDir: root });

    expect(result.files.map((file) => file.relativePath)).toEqual(["src/features/orders/page.tsx"]);
    expect(result.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "node_modules", reason: "ignored" }),
      expect.objectContaining({ path: "dist", reason: "ignored" }),
      expect.objectContaining({ path: "src/notes.md", reason: "unsupported-extension" }),
    ]));
    expect(result.truncated).toBe(false);
  });

  it("does not follow symlinks by default or escape the root when following them", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(outside, "secret.ts"), "export const secret = true");
    await symlink(path.join(outside, "secret.ts"), path.join(root, "src", "outside.ts"));

    const defaultResult = await walkSourceFiles({ rootDir: root });
    expect(defaultResult.files).toHaveLength(0);
    expect(defaultResult.skipped).toContainEqual(expect.objectContaining({ reason: "symlink" }));

    const followedResult = await walkSourceFiles({ rootDir: root, followSymlinks: true });
    expect(followedResult.files).toHaveLength(0);
    expect(followedResult.skipped).toContainEqual(expect.objectContaining({ reason: "outside-root" }));
  });

  it("stops at explicit safety limits", async () => {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, "a.ts"), "export const a = 1");
    await writeFile(path.join(root, "b.ts"), "export const b = 2");

    const result = await walkSourceFiles({ rootDir: root, maxFiles: 1 });

    expect(result.files).toHaveLength(1);
    expect(result.truncated).toBe(true);
    expect(result.skipped).toContainEqual(expect.objectContaining({ reason: "file-limit" }));
  });

  it("honors configured include paths", async () => {
    const root = await temporaryDirectory();
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "src", "app.ts"), "export const app = true");
    await writeFile(path.join(root, "scripts", "build.ts"), "export const build = true");

    const result = await walkSourceFiles({ rootDir: root, include: ["src"] });

    expect(result.files.map((file) => file.relativePath)).toEqual(["src/app.ts"]);
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-web-test-discovery-"));
  temporaryDirectories.push(directory);
  return directory;
}
