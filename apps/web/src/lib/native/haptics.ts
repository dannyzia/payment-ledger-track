import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

function isMotionReduced(): boolean {
  if (typeof window === 'undefined') return false;
  // matchMedia is absent in bare jsdom/Node hosts; treat as motion-sensitive defaults
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export async function triggerHapticTick(): Promise<void> {
  if (isMotionReduced()) return;
  try {
    if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
      await Haptics.impact({ style: ImpactStyle.Light });
    }
  } catch {
    // Graceful no-op in standard web browser
  }
}

export async function triggerHapticSuccess(): Promise<void> {
  if (isMotionReduced()) return;
  try {
    if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
      await Haptics.notification({ type: NotificationType.Success });
    }
  } catch {
    // Graceful no-op in standard web browser
  }
}

export async function triggerHapticWarning(): Promise<void> {
  if (isMotionReduced()) return;
  try {
    if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
      await Haptics.impact({ style: ImpactStyle.Heavy });
    }
  } catch {
    // Graceful no-op in standard web browser
  }
}
