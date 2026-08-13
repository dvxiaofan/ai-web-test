import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isInsideDirectory, isInsideDirectoryReal } from "../../src/core/artifacts.js";
import { loadConfig } from "../../src/core/config.js";

async function workspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "awt-symlink-"));
}

describe("workspace containment survives symbolic links", () => {
  it("treats a link that points outside the root as outside", async () => {
    const root = await workspace();
    const outside = await workspace();
    const link = path.join(root, "artifacts");
    await symlink(outside, link, "dir");

    // The lexical check is fooled by the name; the real one is not.
    expect(isInsideDirectory(root, link)).toBe(true);
    expect(await isInsideDirectoryReal(root, link)).toBe(false);
  });

  it("still accepts a real directory, and one that does not exist yet", async () => {
    const root = await workspace();
    const real = path.join(root, "artifacts");
    await mkdir(real, { recursive: true });

    expect(await isInsideDirectoryReal(root, real)).toBe(true);
    // First run: the directory has not been created yet.
    expect(await isInsideDirectoryReal(root, path.join(root, "report", "modules"))).toBe(true);
  });

  it("refuses to load a config whose artifacts directory is a link out of the workspace", async () => {
    const root = await workspace();
    const outside = await workspace();
    await symlink(outside, path.join(root, "artifacts"), "dir");
    const configPath = path.join(root, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({ schemaVersion: 1, name: "linked", target: { rootDir: "." }, artifacts: { directory: "artifacts" } }),
      "utf8",
    );

    await expect(loadConfig(configPath)).rejects.toMatchObject({
      name: "ConfigValidationError",
      issues: [expect.objectContaining({ path: "artifacts.directory", code: "workspace" })],
    });
  });

  it("loads normally when the artifacts directory is a real directory", async () => {
    const root = await workspace();
    const configPath = path.join(root, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({ schemaVersion: 1, name: "plain", target: { rootDir: "." }, artifacts: { directory: "artifacts" } }),
      "utf8",
    );

    const config = await loadConfig(configPath);
    expect(config.artifacts.directory).toBe(path.join(root, "artifacts"));
  });
});
