/**
 * Which global player shortcut a keydown maps to, given where focus is.
 *
 * Shortcuts only fire when the key isn't already meaningful to the focused
 * element or the browser: modified keys (Ctrl+P print, Alt+← history) stay
 * with the browser, Space activates focused buttons, and arrows keep moving
 * through menus, sliders, lists and dialogs.
 */
export type ShortcutAction =
  | "search"
  | "togglePlay"
  | "seekBack"
  | "seekForward"
  | "volumeUp"
  | "volumeDown"
  | "mute"
  | "next"
  | "previous"
  | "shuffle"
  | "repeat";

const TEXT_ENTRY_ROLES = new Set(["textbox", "searchbox", "combobox"]);

/** Roles whose own keyboard handling uses Space/Enter. */
const ACTIVATABLE_ROLES = new Set([
  "button",
  "link",
  "checkbox",
  "switch",
  "radio",
  "tab",
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "treeitem",
  "slider",
]);

/** Containers whose items are navigated with arrow keys. */
const ARROW_WIDGET_SELECTOR = [
  "[role='menu']",
  "[role='menubar']",
  "[role='listbox']",
  "[role='slider']",
  "[role='tablist']",
  "[role='radiogroup']",
  "[role='grid']",
  "[role='tree']",
  "[role='dialog']",
  "[role='alertdialog']",
  "select",
].join(",");

function isTextEntry(target: HTMLElement): boolean {
  const role = target.getAttribute("role");
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable ||
    (role !== null && TEXT_ENTRY_ROLES.has(role))
  );
}

function isActivatable(target: HTMLElement): boolean {
  const role = target.getAttribute("role");
  return (
    target.tagName === "BUTTON" ||
    target.tagName === "A" ||
    target.tagName === "SUMMARY" ||
    (role !== null && ACTIVATABLE_ROLES.has(role))
  );
}

function isInArrowWidget(target: HTMLElement): boolean {
  return target.closest(ARROW_WIDGET_SELECTOR) !== null;
}

export function resolveShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "altKey" | "defaultPrevented"
  >,
  target: HTMLElement | null,
): ShortcutAction | null {
  if (event.defaultPrevented) return null;
  const element = target ?? document.body;
  const textEntry = isTextEntry(element);
  const commandKey = event.ctrlKey || event.metaKey;

  if (commandKey && !event.altKey && event.key.toLowerCase() === "k") {
    return "search";
  }

  // Media keys carry no text meaning, so they work everywhere.
  switch (event.key) {
    case "MediaPlayPause":
      return "togglePlay";
    case "MediaTrackNext":
      return "next";
    case "MediaTrackPrevious":
      return "previous";
  }

  if (textEntry || event.altKey) return null;

  if (commandKey) {
    if (isInArrowWidget(element)) return null;
    if (event.key === "ArrowUp") return "volumeUp";
    if (event.key === "ArrowDown") return "volumeDown";
    return null;
  }

  switch (event.key) {
    case "/":
      return "search";
    case " ":
      return isActivatable(element) || isInArrowWidget(element)
        ? null
        : "togglePlay";
    case "ArrowLeft":
      return isInArrowWidget(element) ? null : "seekBack";
    case "ArrowRight":
      return isInArrowWidget(element) ? null : "seekForward";
  }

  // Letter shortcuts stay out of menus and dialogs, where letters jump to items.
  if (isInArrowWidget(element)) return null;
  switch (event.key.toLowerCase()) {
    case "m":
      return "mute";
    case "n":
      return "next";
    case "p":
      return "previous";
    case "s":
      return "shuffle";
    case "r":
      return "repeat";
  }
  return null;
}
