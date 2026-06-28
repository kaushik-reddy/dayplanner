// Bookings API for the owner (mirrors the web DayPlanner booking flow).
import { type Bundle, type Task, dateKey, taskState, timeToMinutes } from './planner';

export const BOOK_API = 'https://planner-sync.kaushik4432.workers.dev';
// The guest-facing booking page (the hosted web app). Opening this with ?book=TOKEN
// renders the booking UI; the worker API above only serves JSON data.
export const BOOK_PAGE = 'https://kaushik-reddy.github.io/dayplanner/';

/** The owner's IANA timezone (e.g. "Asia/Kolkata"). Sent with publish + accept so the
 * worker schedules the Google Meet link against the owner's real wall clock — not UTC. */
export function deviceTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

export type BookingStatus =
  | 'pending'
  | 'accepted'
  | 'reschedule_proposed'
  | 'declined'
  | 'cancelled'
  | 'completed'
  | 'no_show'
  | 'missed'
  | 'not_held';

export type Booking = {
  id: string;
  name?: string;
  email?: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  duration?: number;
  note?: string;
  status: BookingStatus;
  proposed?: { date: string; time: string; duration?: number } | null;
  meetLink?: string;
  createdAt?: number;
  updatedAt?: number;
  [k: string]: any;
};

export type BookingConfig = {
  title?: string;
  durationMin?: number;
  [k: string]: any;
};

export type OwnerData = {
  config: BookingConfig;
  busy: Record<string, any>;
  bookings: Booking[];
  googleConnected: boolean;
  exists: boolean;
};

export const ACTIVE_STATUS: BookingStatus[] = ['pending', 'accepted', 'reschedule_proposed'];
export const OUTCOME_STATUS: BookingStatus[] = ['completed', 'no_show', 'missed', 'not_held'];

export function statusMeta(s: BookingStatus): { label: string; color: string } {
  switch (s) {
    case 'pending':
      return { label: 'Pending', color: '#C9974A' };
    case 'accepted':
      return { label: 'Accepted', color: '#6FA88A' };
    case 'reschedule_proposed':
      return { label: 'Reschedule sent', color: '#7FA8C9' };
    case 'declined':
      return { label: 'Declined', color: '#C97A6A' };
    case 'cancelled':
      return { label: 'Cancelled', color: '#C97A6A' };
    case 'completed':
      return { label: 'Completed', color: '#6FA88A' };
    case 'no_show':
      return { label: 'No-show', color: '#C97A6A' };
    case 'missed':
      return { label: 'Missed', color: '#D9A85C' };
    case 'not_held':
      return { label: 'Not held', color: '#C97A6A' };
    default:
      return { label: s, color: '#9A968D' };
  }
}

export function publicLink(token: string): string {
  return `${BOOK_PAGE}?book=${encodeURIComponent(token)}`;
}

export function gauthStartLink(token: string, secret: string): string {
  return `${BOOK_API}/gauth/start?book=${encodeURIComponent(token)}&secret=${encodeURIComponent(secret)}`;
}

export async function pullBookings(token: string, secret: string): Promise<OwnerData> {
  const r = await fetch(
    `${BOOK_API}/?book=${encodeURIComponent(token)}&pull=1&secret=${encodeURIComponent(secret)}`,
  );
  // A brand-new link returns 404 / {exists:false} until the first publish — not a hard error.
  if (r.status === 404) {
    return { config: {}, busy: {}, bookings: [], googleConnected: false, exists: false };
  }
  if (!r.ok) throw new Error(`Bookings failed (${r.status})`);
  const d = await r.json();
  return {
    config: d.config ?? {},
    busy: d.busy ?? {},
    bookings: d.bookings ?? [],
    googleConnected: !!d.googleConnected,
    exists: d.exists !== false,
  };
}

export async function manageBooking(
  token: string,
  secret: string,
  action: string,
  bookingId: string,
  extra?: Record<string, any>,
): Promise<{ ok: boolean; bookings?: Booking[]; clash?: boolean }> {
  const r = await fetch(`${BOOK_API}/?book=${encodeURIComponent(token)}&manage=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerSecret: secret, action, bookingId, ...(extra || {}) }),
  });
  if (r.status === 409) return { ok: false, clash: true };
  if (!r.ok) throw new Error(`Action failed (${r.status})`);
  const d = await r.json();
  return { ok: !!d.ok, bookings: d.bookings };
}

// ---- Owner availability config (synced via bundle.booking.planner_book_config) ----
export type BookConfig = {
  owner?: string;
  durationMin: number;
  days: number[]; // weekday indices 0=Sun..6=Sat
  startMin: number; // minutes from midnight (first window, kept for back-compat)
  endMin: number;
  windows?: [number, number][]; // split availability windows
  slotMin: number; // slot granularity
  horizonDays: number; // how far out guests can book
};

export function bkDefaults(): BookConfig {
  return {
    owner: '',
    durationMin: 30,
    days: [1, 2, 3, 4, 5],
    startMin: 540,
    endMin: 1020,
    windows: [[540, 1020]],
    slotMin: 30,
    horizonDays: 14,
  };
}

export function parseConfig(raw?: string): BookConfig {
  try {
    const c = { ...bkDefaults(), ...(raw ? JSON.parse(raw) : {}) } as BookConfig;
    if (!Array.isArray(c.windows) || !c.windows.length) c.windows = [[c.startMin || 540, c.endMin || 1020]];
    return c;
  } catch {
    return bkDefaults();
  }
}

const TOK_ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789';
export function randId(len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += TOK_ALPHA[Math.floor(Math.random() * TOK_ALPHA.length)];
  return s;
}

export function minToLabel(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const period = h >= 12 ? 'pm' : 'am';
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${String(mm).padStart(2, '0')}${period}`;
}

/** Free/busy windows from the planner's own tasks over the horizon (mirrors web computeBusy). */
export function computeBusy(bundle: Bundle | null, horizonDays: number): Record<string, [number, number][]> {
  const busy: Record<string, [number, number][]> = {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i <= horizonDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const k = dateKey(d);
    const tasks = bundle?.days?.[k]?.tasks ?? [];
    for (const t of tasks) {
      const st = taskState(t);
      if (st === 'cancelled' || st === 'carried') continue;
      const dur = t.duration || 0;
      if (dur <= 0) continue;
      const s = timeToMinutes(t.time);
      (busy[k] = busy[k] || []).push([s, s + dur]);
    }
  }
  return busy;
}

/** Publish availability config + busy windows so the public booking page can render slots. */
export async function publishBooking(
  token: string,
  secret: string,
  config: BookConfig,
  busy: Record<string, [number, number][]>,
): Promise<void> {
  await fetch(`${BOOK_API}/?book=${encodeURIComponent(token)}&publish=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerSecret: secret, config: { ...config, tz: deviceTz() }, busy }),
  });
}

const RECONCILE_ACTIVE: BookingStatus[] = ['pending', 'accepted', 'reschedule_proposed'];
// statuses mirrored into the planner timeline — cancelled is shown (struck-through) so a freed slot keeps its history.
const RECONCILE_SHOWN: BookingStatus[] = [...RECONCILE_ACTIVE, 'cancelled'];

/**
 * Mirror active + cancelled bookings into the planner timeline as `booked` tasks (web reconcileBookings).
 * Adds new ones, moves/updates rescheduled ones, marks cancelled ones, removes tasks for declined/outcome bookings.
 * Returns true if anything changed (so the caller can skip a needless cloud push).
 */
export function reconcileBookings(bundle: Bundle, bookings: Booking[]): boolean {
  if (!bundle.days) bundle.days = {};
  // bookings the owner deleted from the timeline are dismissed (synced via booking.planner_book_dismissed)
  // — never re-imported, even though they remain (cancelled) on the server.
  let dismissed: Set<string>;
  try {
    dismissed = new Set<string>(JSON.parse((bundle.booking?.planner_book_dismissed as string) || '[]'));
  } catch {
    dismissed = new Set<string>();
  }
  const shown = bookings.filter((b) => RECONCILE_SHOWN.includes(b.status) && !dismissed.has(b.id));
  const shownIds = new Set(shown.map((b) => b.id));
  let changed = false;

  const findBooked = (id: string): { key: string; idx: number } | null => {
    for (const key of Object.keys(bundle.days)) {
      const idx = (bundle.days[key].tasks || []).findIndex((t) => t.bookingId === id);
      if (idx >= 0) return { key, idx };
    }
    return null;
  };
  const titleOf = (b: Booking) =>
    (b.status === 'cancelled'
      ? 'Cancelled · '
      : b.status === 'accepted'
        ? 'Booking · '
        : 'Request · ') + (b.name || 'Guest');
  const noteOf = (b: Booking) => [b.note, b.email].filter(Boolean).join(' · ') || undefined;

  for (const b of shown) {
    const loc = findBooked(b.id);
    const title = titleOf(b);
    const note = noteOf(b);
    const isCancelled = b.status === 'cancelled';
    if (!loc) {
      if (!bundle.days[b.date]) bundle.days[b.date] = { tasks: [] };
      bundle.days[b.date].tasks.push({
        id: 'booked_' + b.id,
        time: b.time,
        duration: b.duration || 30,
        title,
        note,
        categories: ['meeting'],
        priority: (b.priority as any) || 'high',
        booked: true,
        bookingId: b.id,
        bookingStatus: b.status,
        cancelled: isCancelled,
        createdAt: Date.now(),
      } as Task);
      changed = true;
    } else {
      const t = bundle.days[loc.key].tasks[loc.idx];
      if (loc.key !== b.date) {
        // rescheduled to a different day — move it
        bundle.days[loc.key].tasks.splice(loc.idx, 1);
        if (!bundle.days[b.date]) bundle.days[b.date] = { tasks: [] };
        Object.assign(t, { time: b.time, duration: b.duration || 30, title, note, bookingStatus: b.status, cancelled: isCancelled });
        bundle.days[b.date].tasks.push(t);
        changed = true;
      } else if (
        t.time !== b.time ||
        (t.duration || 30) !== (b.duration || 30) ||
        t.title !== title ||
        t.note !== note ||
        t.bookingStatus !== b.status ||
        !!t.cancelled !== isCancelled
      ) {
        Object.assign(t, { time: b.time, duration: b.duration || 30, title, note, bookingStatus: b.status, cancelled: isCancelled });
        changed = true;
      }
    }
  }

  // Drop booked tasks whose booking is no longer shown (declined / outcome / removed).
  for (const key of Object.keys(bundle.days)) {
    const day = bundle.days[key];
    if (!day.tasks) continue;
    const before = day.tasks.length;
    day.tasks = day.tasks.filter((t) => !t.bookingId || shownIds.has(t.bookingId));
    if (day.tasks.length !== before) changed = true;
  }

  return changed;
}
