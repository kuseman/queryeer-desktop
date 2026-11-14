const FOCUSABLE_CONTROL_SELECTOR =
  "input, textarea, select, button, [contenteditable='true'], [role='button']";

/**
 * Whether a mousedown inside an editor group should move DOM focus to the group element.
 *
 * React events from a portal bubble through the React tree, so a popup that an editor
 * contribution portals to `document.body` still reaches the group's handler. Such targets
 * are outside the group's DOM node and are left alone; focusing the group would blur the
 * contribution's input and close its popup before the click lands. Controls inside the
 * group keep their own focus.
 */
export function shouldFocusEditorGroupOnPointerDown(group: Node, target: EventTarget | null): boolean {
  if (!(target instanceof Node) || !group.contains(target)) {
    return false;
  }
  const element = target instanceof Element ? target : target.parentElement;
  return !element?.closest(FOCUSABLE_CONTROL_SELECTOR);
}
