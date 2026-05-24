import { describe, expect, it } from "vitest";
import { resolveQflowCodeLensFileId } from "./qflow-language";

describe("qflow language", () => {
  it("uses fileId from model uri when present", () => {
    const result = resolveQflowCodeLensFileId(
      "inmemory://model/1?fileId=flow-123",
      "active-flow"
    );

    expect(result).toBe("flow-123");
  });

  it("falls back to active editor fileId when uri has no fileId", () => {
    const result = resolveQflowCodeLensFileId(
      "file:///workspace/my.flow.qflow",
      "active-flow"
    );

    expect(result).toBe("active-flow");
  });

  it("returns undefined when neither uri nor active editor resolves fileId", () => {
    const result = resolveQflowCodeLensFileId("file:///workspace/my.flow.qflow");

    expect(result).toBeUndefined();
  });
});
