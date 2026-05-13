import { getCommandContext } from "../../core.commands/command-context-accessor";
import { getExpressionRuntime } from "../../core.expressions/runtime";
import { getCoreSettingsService } from "../../core.settings/service";
import { getQueryEngineService } from "../QueryEngineService";
import type { QueryShortcutsConfig, ShortcutRule } from "./shortcut-types";

export const SHORTCUTS_SETTING_ID = "core.queryengine.shortcuts.config";

const EMPTY_CONFIG: QueryShortcutsConfig = { shortcuts: [] };

let instance: ShortcutsService | undefined;

export function getShortcutsService(): ShortcutsService {
  if (!instance) {
    instance = new ShortcutsService();
  }
  return instance;
}

export class ShortcutsService {
  private readonly runtime = getExpressionRuntime();

  getConfig(): QueryShortcutsConfig {
    const raw = getCoreSettingsService()?.getValue(SHORTCUTS_SETTING_ID);
    return parseConfig(raw);
  }

  executeShortcut(slot: number): void {
    const config = this.getConfig();
    const shortcut = config.shortcuts.find((s) => s.slot === slot);
    if (!shortcut?.rules.length) {
      return;
    }

    const ctx = getCommandContext();
    const selectedText = typeof ctx.selectedText === "string" ? ctx.selectedText : "";

    const rule = shortcut.rules.find((r) => this.matchesRule(r, ctx));
    if (!rule) {
      return;
    }

    const text = rule.query.replace(/\$\{selectedText\}/g, selectedText);

    getQueryEngineService().requestExecute({
      textOverride: text,
      outputIdOverride: rule.outputId
    });
  }

  private matchesRule(rule: ShortcutRule, ctx: Record<string, unknown>): boolean {
    if (!rule.when) {
      return true;
    }
    try {
      return this.runtime.evaluateBooleanSync(rule.when, ctx, {
        mode: "when",
        source: `shortcut:${rule.id}`,
        timeoutMs: 50,
      });
    } catch (error) {
      console.error(`[ExpressionRuntime][shortcuts] '${rule.id}' failed :: ${rule.when}`, error);
      return false;
    }
  }
}

function parseConfig(raw: unknown): QueryShortcutsConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return EMPTY_CONFIG;
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.shortcuts)) {
    return EMPTY_CONFIG;
  }
  return {
    shortcuts: obj.shortcuts.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const s = item as Record<string, unknown>;
      const slot = typeof s.slot === "number" ? s.slot : undefined;
      if (slot === undefined || slot < 0 || slot > 9) return [];
      return [{
        slot,
        label: typeof s.label === "string" ? s.label : undefined,
        rules: Array.isArray(s.rules) ? s.rules.flatMap((r) => parseRule(r)) : []
      }];
    })
  };
}

function parseRule(raw: unknown): ShortcutRule[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const r = raw as Record<string, unknown>;
  if (typeof r.query !== "string" || !r.query) return [];
  return [{
    id: typeof r.id === "string" ? r.id : crypto.randomUUID(),
    when: typeof r.when === "string" ? r.when : undefined,
    query: r.query,
    outputId: typeof r.outputId === "string" ? r.outputId : undefined,
    description: typeof r.description === "string" ? r.description : undefined
  }];
}
