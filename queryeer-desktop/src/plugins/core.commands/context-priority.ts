export const ContextPriority = {
  WORKBENCH: 10,
  ZONE: 20,
  EDITOR_GROUP: 30,
  EDITOR_INSTANCE: 40,
  ENGINE_BINDING: 50,
} as const;

export type ContextPriorityLevel = (typeof ContextPriority)[keyof typeof ContextPriority];
