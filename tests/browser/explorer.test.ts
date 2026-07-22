import { describe, expect, it } from "vitest";

import { exploreBrowser, redactText, sanitizeUrl } from "../../src/browser/explorer.js";

describe("safe browser explorer", () => {
  it("returns a structured unavailable result when Playwright cannot start", async () => {
    const result = await exploreBrowser({
      baseUrl: "http://app.test:3000",
      playwrightLoader: async () => {
        throw new Error("browser executable does not exist");
      },
    });
    expect(result.status).toBe("unavailable");
    expect(result.pages).toHaveLength(0);
    expect(result.unavailableReason).toContain("executable");
  });

  it("never starts a browser for an unsafe base URL", async () => {
    let loaded = false;
    const result = await exploreBrowser({
      baseUrl: "file:///tmp/index.html",
      playwrightLoader: async () => {
        loaded = true;
        throw new Error("should not be called");
      },
    });
    expect(result.status).toBe("unavailable");
    expect(loaded).toBe(false);
    expect(result.unavailableReason).toContain("unsafe");
  });

  it("redacts secrets in evidence without changing non-sensitive URL parts", () => {
    expect(sanitizeUrl("https://app.test/orders?id=12&token=secret", [])).toBe(
      "https://app.test/orders?id=12&token=%5BREDACTED%5D",
    );
    expect(redactText("Authorization: Bearer abc.def; token=xyz")).toContain("[REDACTED]");
  });
});
