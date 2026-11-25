const shortcuts = new Map<string, "previous" | "next" | "pronounce" | "activate">([
  ["a", "previous"], ["arrowleft", "previous"],
  ["d", "next"], ["arrowright", "next"],
  ["f", "pronounce"], [" ", "activate"]
]);

export function getRioShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select"))) return;
  return shortcuts.get(event.key.toLowerCase());
}
