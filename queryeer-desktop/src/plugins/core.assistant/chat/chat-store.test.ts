import { describe, expect, it } from "vitest";
import type { FileStateRegistry, StateKey } from "../../../contracts/files/FileStateRegistry";
import {
  appendAssistantMessages,
  clearAssistantMessages,
  getAssistantChatState,
  setAssistantChatSelection,
  setAssistantModels
} from "./chat-store";

class InMemoryFileStateRegistry implements FileStateRegistry {
  private readonly values = new Map<string, Map<string, unknown>>();

  get<T>(fileId: string, key: StateKey<T>): T | undefined {
    return this.values.get(fileId)?.get(key.id) as T | undefined;
  }

  set<T>(fileId: string, key: StateKey<T>, value: T): void {
    let bag = this.values.get(fileId);
    if (!bag) {
      bag = new Map();
      this.values.set(fileId, bag);
    }
    bag.set(key.id, value);
  }

  delete<T>(fileId: string, key: StateKey<T>): void {
    this.values.get(fileId)?.delete(key.id);
  }

  evict(fileId: string): void {
    this.values.delete(fileId);
  }
}

describe("chat-store", () => {
  it("keeps chat selection and history isolated per file", () => {
    const registry = new InMemoryFileStateRegistry();

    setAssistantChatSelection(registry, "file-1", { connectionId: "c1", modelId: "m1" });
    appendAssistantMessages(registry, "file-1", [{ role: "user", content: "hello" }]);
    setAssistantChatSelection(registry, "file-2", { connectionId: "c2", modelId: "m2" });
    appendAssistantMessages(registry, "file-2", [{ role: "user", content: "other" }]);

    expect(getAssistantChatState(registry, "file-1")).toMatchObject({
      selectedConnectionId: "c1",
      selectedModelId: "m1",
      messages: [{ role: "user", content: "hello" }]
    });
    expect(getAssistantChatState(registry, "file-2")).toMatchObject({
      selectedConnectionId: "c2",
      selectedModelId: "m2",
      messages: [{ role: "user", content: "other" }]
    });
  });

  it("stores fetched models by connection", () => {
    const registry = new InMemoryFileStateRegistry();

    setAssistantModels(registry, "file-1", "connection-1", [{ id: "gpt-4.1" }]);

    expect(getAssistantChatState(registry, "file-1").modelsByConnectionId).toEqual({
      "connection-1": [{ id: "gpt-4.1" }]
    });
  });

  it("clears messages without resetting model selection", () => {
    const registry = new InMemoryFileStateRegistry();

    setAssistantChatSelection(registry, "file-1", { connectionId: "c1", modelId: "m1" });
    appendAssistantMessages(registry, "file-1", [{ role: "user", content: "hello" }]);
    clearAssistantMessages(registry, "file-1");

    expect(getAssistantChatState(registry, "file-1")).toMatchObject({
      selectedConnectionId: "c1",
      selectedModelId: "m1",
      messages: []
    });
  });
});
