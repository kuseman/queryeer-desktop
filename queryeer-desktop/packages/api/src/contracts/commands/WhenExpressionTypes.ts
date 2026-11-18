import type { Disposable } from "../editor/EditorApi.js";

export type CtxVar = { name: string; type: "boolean" | "string" | "number"; description: string };
export type CtxMethod = { name: string; signature: string; description: string };
export type WhenExpressionTemplate = { name: string; when: string; description?: string };

/**
 * When-expression help for the user's settings editors: the variables autocompletion offers, and ready-made
 * expressions to start from. Neither changes what an expression evaluates to.
 */
export type WhenExpressionRegistry = {
  /**
   * Ready-made expressions, e.g. "the active file is a MySQL query on database X". Templates with the same name and
   * expression are listed once, and stay listed until every registration of them is disposed.
   */
  registerTemplates: (templates: WhenExpressionTemplate[]) => Disposable;
  /**
   * Context variables to offer in autocompletion, typically the plugin's `activeFile.metadata.<plugin id>.*` keys.
   * Variables with the same name are listed once (the first registration's description), and stay listed until every
   * registration of them is disposed.
   */
  registerVariables: (variables: CtxVar[]) => Disposable;
};
