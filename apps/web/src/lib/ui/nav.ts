import type { UserRole } from '@clt/shared';
import { hasCenterCapability } from '$lib/capabilities';
import { messages } from '../i18n/messages';

/**
 * One list of center destinations, shared by the Sidebar and the command palette.
 *
 * Both surfaces used to keep their own idea of who may see what — the palette a role array
 * per command, the sidebar a role block around five links — so a capability change could
 * leave one of them stale and no test would notice. Now the capability is named once per
 * destination, next to the route, and both render whatever `visibleNav` returns.
 *
 * `canUse` is written per item with a literal capability because `gate-parity.test.ts`
 * reads gates from source and refuses a capability it cannot resolve.
 */
export interface NavItem {
  id: string;
  route: string;
  /** Sidebar label, from the message catalog so it stays i18n-ready. */
  label: string;
  /** Command-palette title. */
  title: string;
  shortcut?: string;
  /** Distinguishes the primary action and the trailing settings section. */
  emphasis?: 'primary' | 'section';
  /** Whether the palette offers this destination; the sidebar shows every item. */
  inPalette: boolean;
  canUse: (callerRole: UserRole) => boolean;
}

export const CENTER_NAV: NavItem[] = [
  {
    id: 'new-entry',
    route: '/entries/new',
    label: messages.menu.newEntry,
    title: 'New Payment Entry',
    shortcut: 'N',
    emphasis: 'primary',
    inPalette: true,
    canUse: (callerRole) => hasCenterCapability(callerRole, 'entry.create'),
  },
  {
    id: 'dashboard',
    route: '/dashboard',
    label: messages.menu.dashboard,
    title: 'Dashboard',
    inPalette: true,
    canUse: (callerRole) => hasCenterCapability(callerRole, 'entry.read_own'),
  },
  {
    id: 'ledger',
    route: '/ledger',
    label: messages.menu.ledger,
    title: 'Ledger',
    shortcut: 'L',
    inPalette: true,
    canUse: (callerRole) => hasCenterCapability(callerRole, 'entry.read_own'),
  },
  {
    id: 'reports',
    route: '/reports',
    label: messages.menu.reports,
    title: 'Monthly Reports',
    shortcut: 'R',
    inPalette: true,
    canUse: (callerRole) => hasCenterCapability(callerRole, 'report.read'),
  },
  {
    id: 'settlements',
    route: '/settlements',
    label: messages.menu.settlements,
    title: 'Settlements & Payables',
    shortcut: 'S',
    inPalette: true,
    canUse: (callerRole) => hasCenterCapability(callerRole, 'settlement.read'),
  },
  {
    id: 'reconcile',
    route: '/reconcile',
    label: messages.menu.reconcile,
    title: 'Reconciliation',
    inPalette: true,
    canUse: (callerRole) => hasCenterCapability(callerRole, 'reconcile.read'),
  },
  {
    id: 'admin',
    route: '/admin',
    label: messages.menu.admin,
    title: 'Admin',
    inPalette: false,
    canUse: (callerRole) => hasCenterCapability(callerRole, 'settings.manage'),
  },
  {
    id: 'admin-settings',
    route: '/admin/settings',
    label: messages.menu.settings,
    title: 'Admin Settings',
    emphasis: 'section',
    inPalette: true,
    canUse: (callerRole) => hasCenterCapability(callerRole, 'settings.manage'),
  },
];

/** The center destinations this role may reach, in sidebar order. */
export function visibleNav(role: UserRole): NavItem[] {
  return CENTER_NAV.filter((item) => item.canUse(role));
}
