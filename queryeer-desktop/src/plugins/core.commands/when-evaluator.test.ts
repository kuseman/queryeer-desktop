import { describe, expect, it } from "vitest";
import { evaluateWhenExpression } from "./when-evaluator";

describe("evaluateWhenExpression", () => {
  it("treats empty/global as true", () => {
    expect(evaluateWhenExpression(undefined, {})).toBe(true);
    expect(evaluateWhenExpression("global", {})).toBe(true);
  });

  it("evaluates boolean identifiers", () => {
    expect(evaluateWhenExpression("editorFocus", { editorFocus: true })).toBe(true);
    expect(evaluateWhenExpression("editorFocus", { editorFocus: false })).toBe(false);
  });

  it("evaluates and/or/not", () => {
    expect(
      evaluateWhenExpression("editorFocus && !terminalFocus", {
        editorFocus: true,
        terminalFocus: false
      })
    ).toBe(true);
    expect(
      evaluateWhenExpression("editorFocus || terminalFocus", {
        editorFocus: false,
        terminalFocus: true
      })
    ).toBe(true);
  });

  it("evaluates equality expressions", () => {
    expect(evaluateWhenExpression("resourceLangId == 'sql'", { resourceLangId: "sql" })).toBe(true);
    expect(evaluateWhenExpression("resourceLangId != 'sql'", { resourceLangId: "json" })).toBe(true);
  });
});
