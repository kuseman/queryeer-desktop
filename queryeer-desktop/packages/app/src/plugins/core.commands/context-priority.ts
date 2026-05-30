export const ContextPriority = {
  WORKBENCH: 10,
  ACTIVE_FILE: 15,
  ZONE: 20,
  EDITOR_GROUP: 30,
  EDITOR_INSTANCE: 40,
  ENGINE_BINDING: 50,
  TREE_NODE: 55,
} as const;

export type ContextPriorityLevel = (typeof ContextPriority)[keyof typeof ContextPriority];
