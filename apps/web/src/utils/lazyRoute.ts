import { lazy, type ComponentType } from "react";

// After a deploy the old hashed chunks are gone, so a tab still running the
// previous index.html fails with "Failed to fetch dynamically imported module".
// Reloading picks up the new index.html; the timestamp guard stops reload loops
// when the failure is something else (e.g. the network is down).
const RELOAD_KEY = "bbpos.chunkReloadAt";
const RELOAD_COOLDOWN_MS = 30_000;

export function isChunkLoadError(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Unable to preload CSS/i.test(message);
}

/** Reload once to fetch the current build. Returns false when it already tried recently or is offline. */
export function reloadForNewBuild() {
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

const routeLoaders: Array<() => Promise<unknown>> = [];

export function lazyRoute<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  routeLoaders.push(factory);
  return lazy(() => factory().catch((error) => {
    // Keep Suspense showing "กำลังโหลด..." while the page reloads.
    if (isChunkLoadError(error) && reloadForNewBuild()) return new Promise<never>(() => {});
    throw error;
  }));
}

/**
 * Fetch every route chunk while idle. Once loaded they stay in memory, so
 * moving between pages later can't hit a chunk removed by a newer deploy
 * (and the service worker has them cached for offline use).
 */
export function preloadRoutes() {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const run = () => routeLoaders.forEach((load) => { load().catch(() => undefined); });
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(run, { timeout: 5_000 });
  else window.setTimeout(run, 2_000);
}
