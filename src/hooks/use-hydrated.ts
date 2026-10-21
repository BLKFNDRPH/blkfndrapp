import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False in the server HTML and on the render that hydrates it, true from then
 * on. Lets a component keep something out of the server HTML without a
 * hydration mismatch.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
