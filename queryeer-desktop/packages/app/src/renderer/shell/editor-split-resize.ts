export function getEditorGroupElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".shell-editor-group"));
}

export function applyEditorGroupSizePreview(
  groupElements: readonly HTMLElement[],
  sizes: readonly number[]
): void {
  groupElements.forEach((element, index) => {
    element.style.flexGrow = String(sizes[index] ?? 1);
  });
}
