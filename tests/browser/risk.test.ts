import { describe, expect, it } from "vitest";

import { classifyActionRisk, riskWithinLimit } from "../../src/browser/risk.js";

describe("browser action risk classification", () => {
  it("treats ordinary links as read-only", () => {
    expect(classifyActionRisk({ kind: "link", text: "订单列表", href: "/orders" }).risk).toBe("read");
  });

  it("recognizes destructive controls without activating them", () => {
    const result = classifyActionRisk({ kind: "control", text: "删除订单", controlType: "button" });
    expect(result.risk).toBe("destructive");
    expect(result.matchedKeyword).toBe("删除");
  });

  it("recognizes mutating forms and submit controls", () => {
    expect(classifyActionRisk({ kind: "form", method: "POST" }).risk).toBe("mutate");
    expect(classifyActionRisk({ kind: "control", controlType: "submit" }).risk).toBe("mutate");
  });

  it("does not classify a logout link as an ordinary read navigation", () => {
    expect(classifyActionRisk({ kind: "link", text: "退出登录", href: "/logout" }).risk).toBe("mutate");
  });

  it("does not match English risk words inside unrelated words", () => {
    expect(classifyActionRisk({ kind: "control", text: "Display settings" }).risk).toBe("read");
  });

  it("compares risks conservatively", () => {
    expect(riskWithinLimit("read", "mutate")).toBe(true);
    expect(riskWithinLimit("destructive", "mutate")).toBe(false);
  });
});
