import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SettingDefinition } from "@queryeer/api/settings/SettingsExtension";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  modalOpen: true,
  modalListener: undefined as (() => void) | undefined,
  requestedSettingId: null as string | null
}));

const definitions: SettingDefinition[] = [
  {
    id: "core.files.mimeTypes",
    moduleId: "core.files",
    title: "MIME Types",
    sectionPath: ["Files", "Mimetype"],
    type: "json",
    defaultValue: []
  },
  {
    id: "com.queryeer.mongodb.connections",
    moduleId: "com.queryeer.mongodb",
    title: "MongoDB Connections",
    sectionPath: ["Query Engines", "MongoDB"],
    type: "json",
    defaultValue: []
  }
];

const serviceMock = {
  isModalOpen: vi.fn(() => mocks.modalOpen),
  subscribeModal: vi.fn((listener: () => void) => {
    mocks.modalListener = listener;
    return () => {};
  }),
  subscribe: vi.fn(() => () => {}),
  refreshSchemaFromRegistry: vi.fn(),
  consumeRequestedSettingId: vi.fn(() => {
    const requestedSettingId = mocks.requestedSettingId;
    mocks.requestedSettingId = null;
    return requestedSettingId;
  }),
  listDefinitions: vi.fn((query: string) => {
    if (!query) {
      return definitions;
    }
    const normalized = query.toLowerCase();
    return definitions.filter((definition) =>
      `${definition.title} ${definition.id}`.toLowerCase().includes(normalized)
    );
  }),
  getValue: vi.fn(() => []),
  setValue: vi.fn(async () => ({ ok: true as const })),
  renderAdvancedSetting: vi.fn(() => null),
  closeModal: vi.fn()
};

vi.mock("./service", () => ({
  getCoreSettingsService: () => serviceMock
}));

import { SettingsModalHost } from "./SettingsModalHost";

void React;

describe("SettingsModalHost", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.modalOpen = true;
    mocks.modalListener = undefined;
    mocks.requestedSettingId = null;
    serviceMock.listDefinitions.mockClear();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("opens a requested setting excluded by the previous search", async () => {
    await act(async () => root.render(<SettingsModalHost />));

    const search = container.querySelector<HTMLInputElement>("input[type='search']");
    expect(search).not.toBeNull();
    await act(async () => {
      if (search) {
        search.value = "mime";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(container.querySelector(".settings-detail")?.textContent).toContain("MIME Types");

    await act(async () => {
      mocks.modalOpen = false;
      mocks.modalListener?.();
    });
    await act(async () => {
      mocks.requestedSettingId = "com.queryeer.mongodb.connections";
      mocks.modalOpen = true;
      mocks.modalListener?.();
    });

    expect(container.querySelector(".settings-detail")?.textContent).toContain("MongoDB Connections");
    expect(container.querySelector<HTMLInputElement>("input[type='search']")?.value).toBe("");
  });
});
