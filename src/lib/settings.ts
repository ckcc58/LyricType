import { writable, type Writable } from "svelte/store";

export const SETTINGS_STORAGE_KEY = "lyrictype-settings";

export type Settings = {
  volume: number;
  timeOffset: number;
};

export const DEFAULT_SETTINGS: Settings = {
  volume: 70,
  timeOffset: 0,
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeSettings(value: unknown): Settings {
  const input = value && typeof value === "object" ? value as Partial<Settings> : {};
  return {
    volume: clampNumber(input.volume, 0, 100, DEFAULT_SETTINGS.volume),
    timeOffset: typeof input.timeOffset === "number" && Number.isFinite(input.timeOffset)
      ? input.timeOffset
      : DEFAULT_SETTINGS.timeOffset,
  };
}

export function parseSettings(raw: string | null | undefined): Settings | null {
  if (!raw) return null;
  try {
    return normalizeSettings(JSON.parse(decodeURIComponent(raw)));
  } catch {
    try {
      return normalizeSettings(JSON.parse(raw));
    } catch {
      return null;
    }
  }
}

function getCookieValue(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  const item = document.cookie
    .split("; ")
    .find((part) => part.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
}

function writeSettingsCookie(value: Settings): void {
  if (typeof document === "undefined") return;
  document.cookie = `${SETTINGS_STORAGE_KEY}=${encodeURIComponent(JSON.stringify(value))}; path=/; max-age=31536000; SameSite=Lax`;
}

function createSettings(): Writable<Settings> {
  const stored = typeof localStorage !== "undefined"
    ? localStorage.getItem(SETTINGS_STORAGE_KEY)
    : null;
  const initial =
    parseSettings(stored) ??
    parseSettings(getCookieValue(SETTINGS_STORAGE_KEY)) ??
    DEFAULT_SETTINGS;

  const store = writable<Settings>(initial);

  store.subscribe((value) => {
    const normalized = normalizeSettings(value);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    }
    writeSettingsCookie(normalized);
  });

  return store;
}

export const settings = createSettings();

export function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  settings.update((s) => ({ ...s, [key]: value }));
}
