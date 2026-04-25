import type { ReactNode } from "react";

export type OutputContext = {
  state: "idle" | "running" | "completed" | "failed" | "cancelled";
  schema: { columns: Array<{ name: string; type: string }> } | null;
  rows: unknown[][];
  metrics: { durationMs?: number; rowCount?: number } | null;
  error: { code: string; message: string } | null;
  progress: { percent?: number; message?: string } | null;
};

export type OutputContributor = {
  id: string;
  title: string;
  render: (context: OutputContext) => ReactNode;
};

let registryInstance: OutputRegistry | undefined;

export function getOutputRegistry(): OutputRegistry {
  if (!registryInstance) {
    registryInstance = new OutputRegistry();
  }
  return registryInstance;
}

export class OutputRegistry {
  private readonly contributors: OutputContributor[] = [];
  private readonly listeners: Array<() => void> = [];

  register(contributor: OutputContributor): void {
    this.contributors.push(contributor);
    for (const listener of this.listeners) {
      listener();
    }
  }

  getContributors(): OutputContributor[] {
    return [...this.contributors];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }
}
