import { describe, expect, it } from "vitest";
import {
  formatPreviewValue,
  inferPreviewMimeType,
  resolveTableLinkAction,
} from "./table-link-actions";

describe("table link actions", () => {
  it("detects and resolves http links", () => {
    const action = resolveTableLinkAction({ value: "https://queryeer.dev/docs", columnType: "string" });
    expect(action).toBeTruthy();
    expect(action?.kind).toBe("external");
    expect(action?.value).toBe("https://queryeer.dev/docs");
  });

  it("detects and resolves json previews", () => {
    const action = resolveTableLinkAction({ value: '{"a":1,"b":true}', columnType: "string" });
    expect(action).toBeTruthy();
    expect(action?.kind).toBe("preview");
    expect(action?.mimeType).toBe("application/json");
    expect(action?.value).toContain("\n");
  });

  it("detects and resolves xml previews", () => {
    const action = resolveTableLinkAction({ value: "<root><x>1</x></root>", columnType: "string" });
    expect(action).toBeTruthy();
    expect(action?.kind).toBe("preview");
    expect(action?.mimeType).toBe("application/xml");
    expect(action?.value).toContain("\n");
  });
});

describe("value preview formatting", () => {
  it("infers json mime type", () => {
    expect(inferPreviewMimeType('{"x":1}')).toBe("application/json");
  });

  it("infers xml mime type", () => {
    expect(inferPreviewMimeType("<a><b/></a>")).toBe("application/xml");
  });

  it("formats json preview", () => {
    const value = formatPreviewValue('{"x":1}', "application/json");
    expect(value).toContain("\n");
  });
});
