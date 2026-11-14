import { afterEach, describe, expect, it } from "vitest";
import { shouldFocusEditorGroupOnPointerDown } from "./editor-group-pointer-focus";

describe("shouldFocusEditorGroupOnPointerDown", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function setup(): { group: HTMLDivElement; popup: HTMLDivElement } {
    document.body.innerHTML = `
      <div id="group" tabindex="-1">
        <div id="pane"><span id="text">text</span></div>
        <input id="input" />
        <button id="button"><span id="button-label">Run</span></button>
        <button id="icon-button"><svg id="icon"><path id="icon-path" d="M0 0" /></svg></button>
      </div>
      <div id="popup"><div id="option">option</div></div>
    `;
    return {
      group: document.getElementById("group") as HTMLDivElement,
      popup: document.getElementById("popup") as HTMLDivElement
    };
  }

  it("focuses the group for non-control targets inside it", () => {
    const { group } = setup();
    expect(shouldFocusEditorGroupOnPointerDown(group, document.getElementById("pane"))).toBe(true);
    expect(shouldFocusEditorGroupOnPointerDown(group, document.getElementById("text")?.firstChild ?? null)).toBe(true);
  });

  it("leaves focus with controls inside the group", () => {
    const { group } = setup();
    expect(shouldFocusEditorGroupOnPointerDown(group, document.getElementById("input"))).toBe(false);
    expect(shouldFocusEditorGroupOnPointerDown(group, document.getElementById("button-label"))).toBe(false);
    // SVG icons are Elements but not HTMLElements; a click on one is a click on its button.
    expect(shouldFocusEditorGroupOnPointerDown(group, document.getElementById("icon-path"))).toBe(false);
  });

  it("ignores targets outside the group, such as a popup portalled to the body", () => {
    const { group } = setup();
    expect(shouldFocusEditorGroupOnPointerDown(group, document.getElementById("option"))).toBe(false);
    expect(shouldFocusEditorGroupOnPointerDown(group, null)).toBe(false);
  });
});
