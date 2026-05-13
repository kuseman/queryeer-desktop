export type CtxVar = { name: string; type: "boolean" | "string" | "number"; description: string };
export type CtxMethod = { name: string; signature: string; description: string };
export type WhenExpressionTemplate = { name: string; when: string; description?: string };
