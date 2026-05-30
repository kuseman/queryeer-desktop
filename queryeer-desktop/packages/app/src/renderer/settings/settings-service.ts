import type { ReactNode } from "react";
import type {
  AdvancedValidationResult,
  SettingDefinition,
  SettingsRegistry
} from "@queryeer/api/settings/SettingsExtension";
import {
  type SettingsIndexDocument,
  type SettingsModuleDocument
} from "@queryeer/api/settings/SettingsDocuments";

type SettingsBridge = {
  getSettingsIndex: () => Promise<SettingsIndexDocument>;
  getSettingsModule: (params: { moduleId: string }) => Promise<SettingsModuleDocument>;
  saveSettingsIndex: (document: SettingsIndexDocument) => Promise<{ accepted: boolean }>;
  saveSettingsModule: (params: {
    moduleId: string;
    document: SettingsModuleDocument;
  }) => Promise<{ accepted: boolean }>;
};

export type SettingsServiceOptions = {
  registry: SettingsRegistry;
  bridge: SettingsBridge;
  notifyBackendModuleChanged?: (moduleId: string, version: number) => Promise<void>;
  debounceMs?: number;
  now?: () => Date;
};

const DEFAULT_DEBOUNCE_MS = 500;

export class SettingsService {
  private readonly registry: SettingsRegistry;
  private readonly bridge: SettingsBridge;
  private readonly notifyBackendModuleChanged?: (moduleId: string, version: number) => Promise<void>;
  private readonly debounceMs: number;
  private readonly now: () => Date;
  private initialized = false;
  private definitions = new Map<string, SettingDefinition>();
  private definitionsOrdered: SettingDefinition[] = [];
  private moduleDocs = new Map<string, SettingsModuleDocument>();
  private effectiveValues = new Map<string, unknown>();
  private readonly valueSubscribers = new Set<() => void>();
  private readonly modalSubscribers = new Set<() => void>();
  private readonly modulePersistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private indexPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private modalOpen = false;
  private requestedSettingId: string | null = null;

  public constructor(options: SettingsServiceOptions) {
    this.registry = options.registry;
    this.bridge = options.bridge;
    this.notifyBackendModuleChanged = options.notifyBackendModuleChanged;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.now = options.now ?? (() => new Date());
  }

  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.refreshSchemaFromRegistry();
    await this.loadPersistedModules();
    this.rebuildEffectiveValues();
    this.initialized = true;
  }

  public refreshSchemaFromRegistry(): void {
    this.definitions.clear();
    for (const definition of this.registry.listSettingsDefinitions()) {
      this.definitions.set(definition.id, definition);
    }
    this.definitionsOrdered = [...this.definitions.values()].sort((a, b) => {
      const sectionA = a.sectionPath.join("/").toLowerCase();
      const sectionB = b.sectionPath.join("/").toLowerCase();
      if (sectionA !== sectionB) {
        return sectionA.localeCompare(sectionB);
      }
      return a.title.localeCompare(b.title);
    });
    this.rebuildEffectiveValues();
  }

  public async syncRegistryModules(): Promise<void> {
    const moduleIds = new Set(
      this.registry.listSettingsContributions().map((contribution) => contribution.moduleId)
    );
    let changed = false;

    for (const moduleId of moduleIds) {
      if (this.moduleDocs.has(moduleId)) {
        continue;
      }

      const doc = await this.bridge.getSettingsModule({ moduleId });
      this.moduleDocs.set(moduleId, {
        version: typeof doc.version === "number" ? doc.version : 1,
        moduleId,
        updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : new Date(0).toISOString(),
        values: typeof doc.values === "object" && doc.values !== null ? doc.values : {}
      });
      changed = true;
    }

    if (changed) {
      this.rebuildEffectiveValues();
      this.emitValuesChanged();
    }
  }

  public listDefinitions(query = ""): SettingDefinition[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return this.definitionsOrdered;
    }
    return this.definitionsOrdered.filter((definition) => {
      const haystack = [
        definition.id,
        definition.title,
        definition.description ?? "",
        definition.moduleId,
        definition.sectionPath.join(" "),
        ...(definition.tags ?? [])
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }

  public getValue(settingId: string): unknown {
    return this.effectiveValues.get(settingId);
  }

  public getAllValues(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of this.effectiveValues) {
      result[key] = value;
    }
    return result;
  }

  public async setValue(settingId: string, nextValue: unknown): Promise<AdvancedValidationResult> {
    const definition = this.definitions.get(settingId);
    if (!definition) {
      return { ok: false, message: `Unknown setting '${settingId}'` };
    }
    if (definition.isSecret && definition.type !== "password") {
      return { ok: false, message: "Secret storage is not enabled yet" };
    }

    const validation = await this.validateValue(definition, nextValue);
    if (!validation.ok) {
      return validation;
    }

    const moduleDoc = this.ensureModuleDocument(definition.moduleId);
    if (Object.is(nextValue, definition.defaultValue)) {
      delete moduleDoc.values[settingId];
    } else {
      moduleDoc.values[settingId] = nextValue;
    }
    moduleDoc.version = (typeof moduleDoc.version === "number" ? moduleDoc.version : 1) + 1;
    moduleDoc.updatedAt = this.now().toISOString();
    this.moduleDocs.set(definition.moduleId, moduleDoc);

    this.rebuildEffectiveValues();
    this.emitValuesChanged();
    this.schedulePersist(definition.moduleId);
    return { ok: true };
  }

  public renderAdvancedSetting(
    definition: SettingDefinition,
    readonly: boolean,
    setValue: (next: unknown) => void
  ): ReactNode | null {
    const rendererId = definition.advanced?.rendererId;
    if (!rendererId) {
      return null;
    }
    const renderer = this.registry.getAdvancedRenderer(rendererId);
    if (!renderer) {
      return null;
    }
    return renderer.render({
      definition,
      value: this.getValue(definition.id),
      setValue,
      readonly
    });
  }

  public subscribe(listener: () => void): () => void {
    this.valueSubscribers.add(listener);
    return () => {
      this.valueSubscribers.delete(listener);
    };
  }

  public openModal(): void {
    this.modalOpen = true;
    this.emitModalChanged();
  }

  public openModalForSetting(settingId: string): void {
    this.requestedSettingId = settingId;
    this.openModal();
  }

  public consumeRequestedSettingId(): string | null {
    const requested = this.requestedSettingId;
    this.requestedSettingId = null;
    return requested;
  }

  public closeModal(): void {
    this.modalOpen = false;
    this.emitModalChanged();
  }

  public isModalOpen(): boolean {
    return this.modalOpen;
  }

  public subscribeModal(listener: () => void): () => void {
    this.modalSubscribers.add(listener);
    return () => {
      this.modalSubscribers.delete(listener);
    };
  }

  public dispose(): void {
    for (const timer of this.modulePersistTimers.values()) {
      clearTimeout(timer);
    }
    this.modulePersistTimers.clear();
    if (this.indexPersistTimer !== null) {
      clearTimeout(this.indexPersistTimer);
      this.indexPersistTimer = null;
    }
  }

  private ensureModuleDocument(moduleId: string): SettingsModuleDocument {
    const existing = this.moduleDocs.get(moduleId);
    if (existing) {
      return existing;
    }
    const created: SettingsModuleDocument = {
      version: 1,
      moduleId,
      updatedAt: this.now().toISOString(),
      values: {}
    };
    this.moduleDocs.set(moduleId, created);
    return created;
  }

  private async loadPersistedModules(): Promise<void> {
    const index = await this.bridge.getSettingsIndex();
    const moduleIds = new Set<string>([
      ...Object.keys(index.modules),
      ...this.registry.listSettingsContributions().map((item) => item.moduleId)
    ]);

    await Promise.all(
      [...moduleIds].map(async (moduleId) => {
        const doc = await this.bridge.getSettingsModule({ moduleId });
        this.moduleDocs.set(moduleId, {
          version: typeof doc.version === "number" ? doc.version : 1,
          moduleId,
          updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : new Date(0).toISOString(),
          values: typeof doc.values === "object" && doc.values !== null ? doc.values : {}
        });
      })
    );
  }

  private rebuildEffectiveValues(): void {
    this.effectiveValues.clear();
    for (const definition of this.definitions.values()) {
      const doc = this.moduleDocs.get(definition.moduleId);
      if (doc && Object.prototype.hasOwnProperty.call(doc.values, definition.id)) {
        this.effectiveValues.set(definition.id, doc.values[definition.id]);
        continue;
      }
      this.effectiveValues.set(definition.id, definition.defaultValue);
    }
  }

  private async validateValue(
    definition: SettingDefinition,
    value: unknown
  ): Promise<AdvancedValidationResult> {
    const baseline = this.validatePrimitive(definition, value);
    if (!baseline.ok) {
      return baseline;
    }

    const validatorId = definition.advanced?.validatorId;
    if (!validatorId) {
      return { ok: true };
    }
    const validator = this.registry.getAdvancedValidator(validatorId);
    if (!validator) {
      return { ok: false, message: `Unknown advanced validator '${validatorId}'` };
    }
    return validator.validate({
      definition,
      value,
      effectiveValues: this.getAllValues()
    });
  }

  private validatePrimitive(definition: SettingDefinition, value: unknown): AdvancedValidationResult {
    switch (definition.type) {
      case "boolean": {
        if (typeof value !== "boolean") {
          return { ok: false, message: "Expected a boolean value" };
        }
        return { ok: true };
      }
      case "string": {
        if (typeof value !== "string") {
          return { ok: false, message: "Expected a string value" };
        }
        if (definition.constraints?.maxLength && value.length > definition.constraints.maxLength) {
          return { ok: false, message: `Value cannot exceed ${definition.constraints.maxLength} characters` };
        }
        if (definition.constraints?.pattern) {
          const regex = new RegExp(definition.constraints.pattern);
          if (!regex.test(value)) {
            return { ok: false, message: "Value does not match required pattern" };
          }
        }
        return { ok: true };
      }
      case "password": {
        if (typeof value !== "string") {
          return { ok: false, message: "Expected a password reference string value" };
        }
        return { ok: true };
      }
      case "number": {
        if (typeof value !== "number" || Number.isNaN(value)) {
          return { ok: false, message: "Expected a number value" };
        }
        if (definition.constraints?.min !== undefined && value < definition.constraints.min) {
          return { ok: false, message: `Value must be >= ${definition.constraints.min}` };
        }
        if (definition.constraints?.max !== undefined && value > definition.constraints.max) {
          return { ok: false, message: `Value must be <= ${definition.constraints.max}` };
        }
        return { ok: true };
      }
      case "enum": {
        if (typeof value !== "string") {
          return { ok: false, message: "Expected an enum string value" };
        }
        const options = definition.options ?? [];
        if (!options.some((option) => option.value === value)) {
          return { ok: false, message: "Value is not in the enum options" };
        }
        return { ok: true };
      }
      case "json": {
        return { ok: true };
      }
      default:
        return { ok: false, message: "Unsupported setting type" };
    }
  }

  private schedulePersist(moduleId: string): void {
    const existing = this.modulePersistTimers.get(moduleId);
    if (existing) {
      clearTimeout(existing);
    }
    this.modulePersistTimers.set(
      moduleId,
      setTimeout(() => {
        void this.persistModule(moduleId);
      }, this.debounceMs)
    );

    if (this.indexPersistTimer !== null) {
      clearTimeout(this.indexPersistTimer);
    }
    this.indexPersistTimer = setTimeout(() => {
      void this.persistIndex();
    }, this.debounceMs);
  }

  private async persistModule(moduleId: string): Promise<void> {
    const timer = this.modulePersistTimers.get(moduleId);
    if (timer) {
      clearTimeout(timer);
      this.modulePersistTimers.delete(moduleId);
    }
    const doc = this.moduleDocs.get(moduleId);
    if (!doc) {
      return;
    }
    await this.bridge.saveSettingsModule({
      moduleId,
      document: {
        ...doc,
        moduleId,
        updatedAt: this.now().toISOString()
      }
    });
    if (this.notifyBackendModuleChanged) {
      try {
        await this.notifyBackendModuleChanged(moduleId, doc.version);
      } catch {
        // Best-effort notification; do not fail persistence
      }
    }
  }

  private async persistIndex(): Promise<void> {
    if (this.indexPersistTimer !== null) {
      clearTimeout(this.indexPersistTimer);
      this.indexPersistTimer = null;
    }
    const modules: SettingsIndexDocument["modules"] = {};
    for (const [moduleId, doc] of this.moduleDocs) {
      modules[moduleId] = {
        file: `${moduleId}.json`,
        version: doc.version,
        updatedAt: doc.updatedAt
      };
    }
    await this.bridge.saveSettingsIndex({
      version: 1,
      updatedAt: this.now().toISOString(),
      modules
    });
  }

  private emitValuesChanged(): void {
    for (const listener of this.valueSubscribers) {
      listener();
    }
  }

  private emitModalChanged(): void {
    for (const listener of this.modalSubscribers) {
      listener();
    }
  }
}
