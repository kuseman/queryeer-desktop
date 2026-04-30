export type { OutputContext, OutputContributor, RowChunk } from "../../../contracts/extensions/OutputExtension";
import type { OutputContributor, RowChunk } from "../../../contracts/extensions/OutputExtension";

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
  private selectedPrimaryId: string | null = null;

  register(contributor: OutputContributor): void {
    this.contributors.push(contributor);
    for (const listener of this.listeners) {
      listener();
    }
  }

  getContributors(): OutputContributor[] {
    return [...this.contributors].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  getSelectablePrimaryContributors(): OutputContributor[] {
    return this.getContributors().filter((contributor) =>
      contributor.mode === "primary" && contributor.selectable !== false
    );
  }

  setSelectedPrimary(id: string | null): void {
    this.selectedPrimaryId = id;
  }

  getSelectedPrimaryId(): string | null {
    return this.selectedPrimaryId;
  }

  /**
   * Called on every chunkRows event before the React state update.
   * Forwards the chunk to the currently selected primary contributor's onChunkRows
   * hook, allowing Ag-Grid to call applyTransaction() without a full re-render.
   */
  notifyChunkRows(chunk: RowChunk, targetPrimaryId?: string | null): void {
    const effectivePrimaryId = targetPrimaryId ?? this.selectedPrimaryId;
    const primary = this.contributors.find((c) => c.id === effectivePrimaryId);
    primary?.onChunkRows?.(chunk);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }
}
