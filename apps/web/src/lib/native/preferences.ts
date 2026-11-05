import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

// In-memory store fallback for Node 22 / Vitest environments without localStorage
const memoryStore = new Map<string, string>();

function getStorageItem(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch {
    // Storage restricted fallback
  }
  return memoryStore.get(key) ?? null;
}

function setStorageItem(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return;
    }
  } catch {
    // Storage restricted fallback
  }
  memoryStore.set(key, value);
}

export async function getNativePreference(key: string): Promise<string | null> {
  try {
    if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
      const { value } = await Preferences.get({ key });
      return value ?? null;
    }
    return getStorageItem(key);
  } catch {
    return memoryStore.get(key) ?? null;
  }
}

export async function setNativePreference(key: string, value: string): Promise<void> {
  try {
    if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
      await Preferences.set({ key, value });
      return;
    }
    setStorageItem(key, value);
  } catch {
    memoryStore.set(key, value);
  }
}
