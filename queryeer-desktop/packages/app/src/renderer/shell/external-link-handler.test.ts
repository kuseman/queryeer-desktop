import { describe, expect, it, vi, afterEach } from "vitest";
import { installGlobalExternalLinkHandler, shouldOpenExternally } from "./external-link-handler";

describe("external-link-handler", () => {
  const originalAppShell = window.appShell;

  afterEach(() => {
    window.appShell = originalAppShell;
    document.body.innerHTML = "";
  });

  it("detects external links only", () => {
    expect(shouldOpenExternally("https://example.com")).toBe(true);
    expect(shouldOpenExternally("http://example.com")).toBe(true);
    expect(shouldOpenExternally("mailto:test@example.com")).toBe(true);
    expect(shouldOpenExternally("#section")).toBe(false);
    expect(shouldOpenExternally("/relative/path")).toBe(false);
  });

  it("opens external anchor clicks through the shell", () => {
    const openExternal = vi.fn(async () => undefined);
    window.appShell = { openExternal } as unknown as typeof window.appShell;
    document.body.innerHTML = `<a href="https://example.com"><span>Example</span></a>`;
    const dispose = installGlobalExternalLinkHandler(document);
    const span = document.querySelector("span")!;

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    span.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(openExternal).toHaveBeenCalledWith("https://example.com");
    dispose();
  });

  it("ignores already handled clicks", () => {
    const openExternal = vi.fn(async () => undefined);
    window.appShell = { openExternal } as unknown as typeof window.appShell;
    document.body.innerHTML = `<a href="https://example.com">Example</a>`;
    const dispose = installGlobalExternalLinkHandler(document);
    const anchor = document.querySelector("a")!;
    anchor.addEventListener("click", (event) => event.preventDefault());

    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(openExternal).not.toHaveBeenCalled();
    dispose();
  });
});
