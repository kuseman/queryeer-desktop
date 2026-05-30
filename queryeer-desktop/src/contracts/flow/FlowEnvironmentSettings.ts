export const FLOW_ENVIRONMENTS_SETTING_ID = "core.flow.environments";

export type FlowEnvironmentConfig = {
  activeEnvironment: string;
  environments: string[];
  mappings: FlowLocalMapping[];
};

export type FlowLocalMapping = {
  environment: string;
  owner: string;
  kind: string;
  ref: string;
  value: string;
};
