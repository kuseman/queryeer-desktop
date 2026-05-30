import { vi } from "vitest";

if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    font: "",
    measureText: (text: string) => ({ width: text.length * 7 }),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
