type HasModifierKeys = { ctrlKey: boolean; metaKey: boolean };

export function isPrimaryModifier(event: HasModifierKeys | null | undefined): boolean {
  return event != null && (event.ctrlKey || event.metaKey);
}
