export type SettlementStatus = 'not_applicable' | 'due' | 'partly_paid' | 'paid' | 'overpaid';

/**
 * Authoritative 5-state settlement status calculator (PRD §8.4, §7.3 calc_settlement_status parity).
 */
export function calcSettlementStatus(expected: bigint, paid: bigint): SettlementStatus {
  if (expected === 0n && paid === 0n) return 'not_applicable';
  if (expected > 0n && paid === 0n) return 'due';
  if (paid > 0n && paid < expected) return 'partly_paid';
  if (paid === expected) return 'paid';
  if (paid > expected) return 'overpaid';
  return 'due';
}

export interface ReminderStatus {
  dueDate: string; // YYYY-MM-DD
  isOverdue: boolean;
  daysRemaining: number;
  inReminderWindow: boolean;
  formattedDueDay: string; // e.g. "1st", "2nd", "3rd", "15th", "22nd"
}

const getDhakaToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());

/**
 * Formats a day number with its correct English ordinal suffix.
 */
export function formatOrdinalDay(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`;
  switch (day % 10) {
    case 1: return `${day}st`;
    case 2: return `${day}nd`;
    case 3: return `${day}rd`;
    default: return `${day}th`;
  }
}

/**
 * Computes settlement due date and in-app reminder window.
 * Due date is in the month following settlementMonth on dueDay (clamped to target month length, e.g. Feb 28/29).
 * Pure UTC calculation eliminates host local timezone shifts and DST artifacts.
 */
export function computeSettlementReminder(
  settlementMonth: string, // YYYY-MM or YYYY-MM-01
  dueDay: number,
  remindDaysBefore: number = 3,
  currentDateStr?: string
): ReminderStatus {
  const todayStr = currentDateStr ?? getDhakaToday();
  const [curYear, curMonth, curDay] = todayStr.split('-').map(Number);
  const todayEpochDays = Math.floor(Date.UTC(curYear, curMonth - 1, curDay) / 86400000);

  const [settleYear, settleMonth] = settlementMonth.slice(0, 7).split('-').map(Number);

  // Target month is the month immediately following settlementMonth (settleMonth is 1-based)
  const targetProbe = new Date(Date.UTC(settleYear, settleMonth, 1));
  const dueYear = targetProbe.getUTCFullYear();
  const dueMonthIndex = targetProbe.getUTCMonth(); // 0-based
  const daysInTargetMonth = new Date(Date.UTC(dueYear, dueMonthIndex + 1, 0)).getUTCDate();
  const clampedDay = Math.min(Math.max(dueDay, 1), daysInTargetMonth);

  const targetDate = new Date(Date.UTC(dueYear, dueMonthIndex, clampedDay));
  const dueMonth = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
  const dueDayStr = String(targetDate.getUTCDate()).padStart(2, '0');
  const dueDate = `${dueYear}-${dueMonth}-${dueDayStr}`;

  const dueEpochDays = Math.floor(Date.UTC(dueYear, dueMonthIndex, clampedDay) / 86400000);
  const daysRemaining = dueEpochDays - todayEpochDays;
  const isOverdue = daysRemaining < 0;
  const inReminderWindow = daysRemaining >= 0 && daysRemaining <= remindDaysBefore;

  return {
    dueDate,
    isOverdue,
    daysRemaining,
    inReminderWindow,
    formattedDueDay: formatOrdinalDay(clampedDay),
  };
}
