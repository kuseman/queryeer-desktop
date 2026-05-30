import type { FlowNodeTypeContribution, FlowNodeTypeTemplate, FlowNodeCodeLensItem, FlowNodeSummaryItem, FlowNodeConfigurationProps, FlowNodeConfigurationValidationResult } from "../../contracts/flow/FlowNodeTypeContribution.js";

export type { FlowNodeTypeTemplate, FlowNodeCodeLensItem, FlowNodeSummaryItem, FlowNodeConfigurationProps, FlowNodeConfigurationValidationResult };

const contributions = new Map<string, FlowNodeTypeContribution>();

export function registerFlowNodeTypeContribution(
  contribution: FlowNodeTypeContribution
): () => void {
  contributions.set(contribution.id, contribution);
  return () => {
    if (contributions.get(contribution.id) === contribution) {
      contributions.delete(contribution.id);
    }
  };
}

export function getFlowNodeTypeContribution(type: string): FlowNodeTypeContribution | undefined {
  return contributions.get(type);
}

export function listFlowNodeTypeContributions(): FlowNodeTypeContribution[] {
  return [...contributions.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function clearFlowNodeTypeContributionsForTests(): void {
  contributions.clear();
}
