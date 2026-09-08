import { useSyncExternalStore } from "react";

/**
 * The `X-Admin-Key` (`WOW_ADMIN_KEY`), held for the tab and nowhere else.
 *
 * WHY IT LIVES HERE AND NOT IN A COMPONENT: three screens now need it — the
 * geo-fence editor, the login log and the attendance log — and typing it again
 * per screen is the kind of friction that ends with someone pasting it into a
 * sticky note. One module-level value means it is entered once per tab.
 *
 * WHY NOT localStorage, AND WHY NOT A VITE_ VAR: it is a shared, long-lived
 * admin secret (UI_FLOW §7.7, §8.2). A VITE_ var ships it in the bundle for
 * every end user to read; localStorage leaves it on the machine after the tab
 * closes. In memory it dies with the tab, which is the intended lifetime.
 *
 * Deliberately not part of `Session`: the session IS persisted, and merging the
 * two is how the key would quietly end up on disk.
 */
let key = "";
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setAdminKey(next: string) {
  key = next;
  emit();
}

export function getAdminKey(): string {
  return key;
}

/** Cleared on sign-out — the next person at this machine starts with nothing. */
export function clearAdminKey() {
  setAdminKey("");
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `[key, setKey]`, shaped like useState so screens read the same as before. */
export function useAdminKey(): [string, (next: string) => void] {
  return [useSyncExternalStore(subscribe, getAdminKey, getAdminKey), setAdminKey];
}
