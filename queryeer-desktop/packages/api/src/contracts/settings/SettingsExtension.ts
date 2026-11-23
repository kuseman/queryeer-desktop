import type { Disposable } from "../editor/EditorApi.js";
import type { ReactNode } from "react";
import type { SecretRefValue } from "../security/Security.js";

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

export type SettingsContributionRegistry = {
  registerSettings: (contribution: SettingsContribution) => Disposable;
  registerAdvancedRenderer: (renderer: AdvancedSettingsRenderer) => Disposable;
  registerAdvancedValidator: (validator: AdvancedSettingsValidator) => Disposable;
  listSettingsContributions: () => SettingsContribution[];
  listSettingsDefinitions: () => SettingDefinition[];
  getAdvancedRenderer: (id: string) => AdvancedSettingsRenderer | undefined;
  getAdvancedValidator: (id: string) => AdvancedSettingsValidator | undefined;
};

export type SettingsRegistry = SettingsContributionRegistry & {
  getValue: <T = unknown>(settingId: string) => T | undefined;
  getAllValues: () => Readonly<Record<string, unknown>>;
  subscribe: (listener: () => void) => Disposable;
  open: (settingId?: string) => void;
  /**
   * Sets a registered setting, validated and saved like an edit in Settings. A failure is in the result (`ok: false`),
   * not thrown; in a `runOnce` task, throw it so the task runs again. Since 0.21.
   */
  setValue: (settingId: string, value: unknown) => Promise<AdvancedValidationResult>;
  /**
   * The stored values of any settings module, also one no plugin registers any more, by setting id. A copy. Since 0.21.
   */
  readModuleValues: (moduleId: string) => Promise<Readonly<Record<string, unknown>>>;
  /**
   * Runs `run` once per installation, after settings are loaded (at startup, once every plugin has activated), e.g. to
   * migrate settings from another module. `id` is per plugin; use a new one for a new migration. It counts as done only
   * when it resolves, after what it changed is saved; one that throws runs again on the next start. Since 0.21.
   */
  runOnce: (id: string, run: () => void | Promise<void>) => void;
  /**
   * A deep copy of `value` in which every `{ secretRef }` object points at its own new copy of the vault entry. Use it
   * when cloning a setting, e.g. a connection in a `CollectionSettingsListEditor`: a copied `secretRef` would share one
   * vault entry, so editing or clearing the password of either row would change the other's. Works while the vault is
   * locked. A secret that can't be copied (unknown ref, no vault) becomes `undefined`, so the clone has no secret
   * rather than a shared one. Arrays and plain objects are walked; other values are kept as they are. Since 0.23.
   */
  copySecrets: <T>(value: T) => Promise<T>;
};

export type CollectionSettingsListItem = {
  id: string;
  label: string;
  subtitle?: string;
  invalid?: boolean;
};

export type CollectionSettingsListEditorProps = {
  items: readonly CollectionSettingsListItem[];
  selectedId: string | undefined;
  readonly: boolean;
  addLabel?: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onClone: (id: string) => void;
  onDelete: (id: string) => void;
  renderDetails: (id: string | undefined) => ReactNode;
};

export type UseCollectionSettingsPersistence = <T>(options: {
  persist: (items: T[]) => void;
  debounceMs?: number;
}) => {
  persistNow: (items: T[]) => void;
  persistDebounced: (items: T[]) => void;
};

export type PasswordFieldInputProps = {
  inputId: string;
  valueRef: string | SecretRefValue | undefined;
  readonly?: boolean;
  onChangeRef: (nextRef: SecretRefValue | undefined) => void;
};
