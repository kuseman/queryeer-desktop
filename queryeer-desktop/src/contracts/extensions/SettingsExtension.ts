import type { ReactNode } from "react";

export type SettingsValueType =
  | "boolean"
  | "string"
  | "password"
  | "number"
  | "enum"
  | "json";

export type SettingOption = {
  value: string;
  label: string;
  description?: string;
};

export type SettingConstraints = {
  min?: number;
  max?: number;
  pattern?: string;
  maxLength?: number;
};

export type AdvancedSettingSpec = {
  rendererId: string;
  validatorId?: string;
};

export type SettingDefinition = {
  id: string;
  moduleId: string;
  title: string;
  description?: string;
  sectionPath: string[];
  tags?: string[];
  scope?: "workspace";
  type: SettingsValueType;
  defaultValue: unknown;
  options?: SettingOption[];
  constraints?: SettingConstraints;
  isSecret?: boolean;
  advanced?: AdvancedSettingSpec;
};

export type SettingsContribution = {
  moduleId: string;
  title: string;
  order?: number;
  settings: SettingDefinition[];
};

export type AdvancedSettingsRenderer = {
  id: string;
  render: (context: {
    definition: SettingDefinition;
    value: unknown;
    setValue: (next: unknown) => void;
    readonly: boolean;
  }) => ReactNode;
};

export type AdvancedValidationResult =
  | { ok: true }
  | { ok: false; message: string };

export type AdvancedSettingsValidator = {
  id: string;
  validate: (context: {
    definition: SettingDefinition;
    value: unknown;
    effectiveValues: Record<string, unknown>;
  }) => AdvancedValidationResult | Promise<AdvancedValidationResult>;
};

export type SettingsRegistry = {
  registerSettings: (contribution: SettingsContribution) => void;
  registerAdvancedRenderer: (renderer: AdvancedSettingsRenderer) => void;
  registerAdvancedValidator: (validator: AdvancedSettingsValidator) => void;
  listSettingsContributions: () => SettingsContribution[];
  listSettingsDefinitions: () => SettingDefinition[];
  getAdvancedRenderer: (id: string) => AdvancedSettingsRenderer | undefined;
  getAdvancedValidator: (id: string) => AdvancedSettingsValidator | undefined;
};
