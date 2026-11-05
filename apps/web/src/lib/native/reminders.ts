import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { formatPoishaToBdt } from '@clt/shared';

export const SETTLEMENT_CHANNEL_ID = 'settlement_reminders';

export interface SettlementReminderItem {
  id: string;
  payableName: string;
  dueDay: number;
  remindDaysBefore: number;
  expectedPoisha: bigint;
  paidPoisha: bigint;
  month: string; // YYYY-MM or YYYY-MM-01
}

export async function ensureNotificationChannel(): Promise<void> {
  if (typeof window === 'undefined' || !Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.createChannel({
      id: SETTLEMENT_CHANNEL_ID,
      name: 'Settlement Due Reminders',
      description: 'Reminders for upcoming monthly vendor and tax settlement deadlines',
      importance: 4, // High importance (heads-up notification)
      visibility: 1,
      vibration: true,
      sound: undefined,
    });
  } catch (err) {
    console.warn('Failed to create notification channel:', err);
  }
}

export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
      const status = await LocalNotifications.requestPermissions();
      return status.display === 'granted';
    }
  } catch {
    // Non-native no-op
  }
  return false;
}

/**
 * Computes reminder date aligned strictly with Plan 014:
 * Settlements for month M are due in month M+1 on dueDay (clamped to target month length).
 */
export function computeReminderDate(settlementMonth: string, dueDay: number, remindDaysBefore: number): Date {
  const [settleYear, settleMonth] = settlementMonth.slice(0, 7).split('-').map(Number);
  // Probe target month (month following settlementMonth; settleMonth is 1-based, so Date.UTC(settleYear, settleMonth, 1) is next month)
  const targetProbe = new Date(Date.UTC(settleYear, settleMonth, 1));
  const dueYear = targetProbe.getUTCFullYear();
  const dueMonthIndex = targetProbe.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(dueYear, dueMonthIndex + 1, 0)).getUTCDate();
  const clampedDueDay = Math.min(Math.max(dueDay, 1), daysInMonth);
  const reminderDay = Math.max(1, clampedDueDay - remindDaysBefore);

  return new Date(dueYear, dueMonthIndex, reminderDay, 9, 0, 0); // 9:00 AM local device time
}

export async function scheduleSettlementReminders(settlements: SettlementReminderItem[]): Promise<void> {
  if (typeof window === 'undefined' || !Capacitor.isNativePlatform()) return;

  try {
    await ensureNotificationChannel();

    const pendingList = await LocalNotifications.getPending();
    const existingIds = new Set(pendingList.notifications.map((n) => n.id));
    const notificationsToSchedule: Parameters<typeof LocalNotifications.schedule>[0]['notifications'] = [];

    for (const item of settlements) {
      // Deterministic positive 31-bit integer notification ID from UUID
      const notificationId = Math.abs(item.id.split('-').reduce((acc, part) => acc ^ parseInt(part, 16), 0)) % 100000;

      // Cancel reminder if already settled or zero liability
      if (item.paidPoisha >= item.expectedPoisha) {
        if (existingIds.has(notificationId)) {
          await LocalNotifications.cancel({ notifications: [{ id: notificationId }] });
        }
        continue;
      }

      const scheduledTime = computeReminderDate(item.month, item.dueDay, item.remindDaysBefore);
      if (scheduledTime.getTime() <= Date.now()) {
        continue;
      }

      const outstanding = item.expectedPoisha - item.paidPoisha;

      notificationsToSchedule.push({
        id: notificationId,
        channelId: SETTLEMENT_CHANNEL_ID,
        title: `Settlement Due: ${item.payableName}`,
        body: `Payment of ${formatPoishaToBdt(outstanding)} is due on the ${item.dueDay}th.`,
        schedule: { at: scheduledTime },
        smallIcon: 'ic_stat_notification',
        extra: { settlementId: item.id },
      });
    }

    if (notificationsToSchedule.length > 0) {
      await LocalNotifications.schedule({ notifications: notificationsToSchedule });
    }
  } catch (err) {
    console.warn('Failed to schedule local settlement reminders:', err);
  }
}
