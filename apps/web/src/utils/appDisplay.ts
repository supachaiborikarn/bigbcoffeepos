// Install-as-app (PWA) and full-screen helpers for the shop tablets.
//
// Chrome fires `beforeinstallprompt` once, early, and only when the manifest
// is installable — often before React has mounted the top bar — so the event
// is captured at startup (initInstallPrompt in main.tsx) and kept here.

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export function initInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // show our own "ติดตั้งแอป" button instead of Chrome's mini bar
    deferredPrompt = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
  document.addEventListener("fullscreenchange", notify);
}

export function onAppDisplayChange(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export const canInstallApp = () => deferredPrompt !== null;

/** Opens Chrome's install dialog. Returns true when the user accepted. */
export async function installApp() {
  const event = deferredPrompt;
  if (!event) return false;
  deferredPrompt = null; // a prompt event can only be used once
  notify();
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome === "accepted";
}

/** True when running as the installed app with no browser bars at all. */
export function isAppFullscreenMode() {
  return typeof window.matchMedia === "function" && window.matchMedia("(display-mode: fullscreen)").matches;
}

export function canToggleFullscreen() {
  return typeof document !== "undefined" && Boolean(document.fullscreenEnabled) && !isAppFullscreenMode();
}

export const isFullscreen = () => Boolean(document.fullscreenElement);

export async function toggleFullscreen() {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await document.documentElement.requestFullscreen({ navigationUI: "hide" });
}
