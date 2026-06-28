import AsyncStorage from '@react-native-async-storage/async-storage';

// ---- Types (mirror the web DayPlanner data model) ----
export type Priority = 'low' | 'medium' | 'high' | 'must';

export type Task = {
  id: string;
  title: string;
  time: string; // "HH:MM"
  duration?: number; // minutes
  categories?: string[];
  category?: string;
  priority?: Priority;
  note?: string;
  createdAt?: number;
  done?: boolean;
  completedAt?: number;
  startedAt?: number;
  runningSince?: number | null;
  accumMs?: number;
  pausedSince?: number | null;
  pausedAccumMs?: number;
  cancelled?: boolean;
  carried?: boolean;
  recurId?: string;
  origTime?: string;
  origKey?: string;
  changes?: TaskChange[];
  [k: string]: any;
};

export type TaskChange = {
  type: 'moved' | 'rescheduled' | 'swapped' | string;
  from: string;
  to: string;
  at: number;
  fromKey?: string;
  toKey?: string;
};

export type DayData = { tasks: Task[]; closed?: boolean; [k: string]: any };
export type ActivityEntry = {
  id: string;
  ts: number;
  type: string; // created/edited/started/paused/resumed/completed/cancelled/reset/moved/swapped/carried/deleted/closed
  title: string;
  time?: string;
  day: string; // dateKey the task belonged to
  detail?: string;
};
export type Bundle = {
  days: Record<string, DayData>;
  recurring?: any[];
  imgCache?: any;
  booking?: any;
  activity?: ActivityEntry[];
};

export type TaskState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'carried';

// ---- Constants ----
export const SYNC_API = 'https://planner-sync.kaushik4432.workers.dev';
export const DEFAULT_SYNC_CODE = 'kaushik-planner';

const K_CODE = 'dp.syncCode';
const K_BUNDLE = 'dp.bundle';
const K_VER = 'dp.ver';

// ---- Date / time helpers ----
export function dateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function timeToMinutes(t: string): number {
  const [h, m] = (t || '0:0').split(':').map(Number);
  return h * 60 + m;
}

export function fmtTime(t: string): string {
  const [h, m] = (t || '0:0').split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${String(m).padStart(2, '0')}${period}`;
}

export function fmtDuration(min?: number): string {
  if (!min || min <= 0) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// ---- Task state ----
export function taskState(t: Task): TaskState {
  if (t.cancelled) return 'cancelled';
  if (t.carried) return 'carried';
  if (t.done || t.completedAt) return 'completed';
  if (t.startedAt) return 'running';
  return 'pending';
}

export function isPaused(t: Task): boolean {
  return (
    !!t.startedAt &&
    !t.completedAt &&
    !t.cancelled &&
    !t.carried &&
    t.runningSince == null &&
    t.accumMs != null
  );
}

export function isActive(t: Task): boolean {
  return taskState(t) === 'running' && !isPaused(t);
}

export function sortByTime(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) => timeToMinutes(a.time) - timeToMinutes(b.time),
  );
}

// ---- Priority + category ----
export function prioMeta(p?: Priority): { n: number; label: string } | null {
  switch (p) {
    case 'low':
      return { n: 1, label: 'Low' };
    case 'medium':
      return { n: 2, label: 'Med' };
    case 'high':
      return { n: 3, label: 'High' };
    case 'must':
      return { n: 4, label: 'Must' };
    default:
      return null;
  }
}

const CAT_COLORS: Record<string, string> = {
  work: '#C9974A',
  watch: '#C97A6A',
  read: '#7FA8C9',
  sleep: '#8E84C9',
  errand: '#6FA88A',
  general: '#9A968D',
};

export function catColor(c: string): string {
  if (CAT_COLORS[c]) return CAT_COLORS[c];
  const pal = [
    '#C9974A',
    '#7FA8C9',
    '#8FB996',
    '#C97A6A',
    '#8E84C9',
    '#6FA88A',
    '#D9A85C',
    '#9A968D',
  ];
  let h = 0;
  for (let i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) >>> 0;
  return pal[h % pal.length];
}

export function getCategories(t: Task): string[] {
  if (Array.isArray(t.categories)) return t.categories;
  if (t.category) return [t.category];
  return [];
}

export function catLabel(c: string): string {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

// ---- Persistence ----
export async function getSyncCode(): Promise<string> {
  const v = await AsyncStorage.getItem(K_CODE);
  return v ?? DEFAULT_SYNC_CODE;
}

export async function setSyncCode(code: string): Promise<void> {
  await AsyncStorage.setItem(K_CODE, code);
  await AsyncStorage.removeItem(K_VER);
  await AsyncStorage.removeItem(K_BUNDLE);
}

export async function getCachedBundle(): Promise<Bundle | null> {
  const raw = await AsyncStorage.getItem(K_BUNDLE);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function cacheBundle(b: Bundle, version: number): Promise<void> {
  await AsyncStorage.setItem(K_BUNDLE, JSON.stringify(b));
  await AsyncStorage.setItem(K_VER, String(version));
}

export async function getCachedVersion(): Promise<number> {
  const v = await AsyncStorage.getItem(K_VER);
  return v ? parseInt(v, 10) || 0 : 0;
}

// ---- Sync ----
export async function pullBundle(
  code: string,
): Promise<{ version: number; data: Bundle }> {
  const r = await fetch(`${SYNC_API}?code=${encodeURIComponent(code)}`);
  if (!r.ok) throw new Error(`Sync failed (${r.status})`);
  const res = await r.json();
  const data: Bundle = res.data ?? { days: {} };
  const version: number = res.version ?? 0;
  if (version > 0) await cacheBundle(data, version);
  return { version, data };
}

export async function pushBundle(
  code: string,
  baseVersion: number,
  data: Bundle,
): Promise<{ ok: boolean; version: number; conflict?: boolean; data?: Bundle }> {
  const r = await fetch(SYNC_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, baseVersion, data }),
  });
  if (r.status === 409) {
    const res = await r.json();
    return { ok: false, version: res.version ?? baseVersion, conflict: true, data: res.data };
  }
  if (!r.ok) throw new Error(`Save failed (${r.status})`);
  const res = await r.json();
  const version = res.version ?? baseVersion;
  await cacheBundle(data, version);
  return { ok: true, version };
}

// ---- Convenience ----
export function tasksForDay(bundle: Bundle | null, key: string): Task[] {
  const real = bundle?.days?.[key]?.tasks ?? [];
  return sortByTime([...real, ...recurringForDay(bundle, key)]);
}

// ---- Recurring ----
export type RepeatType = 'daily' | 'weekdays' | 'weekends' | 'weekly' | 'monthly' | 'yearly';
export type Recurring = {
  id: string;
  anchor: string; // YYYY-MM-DD start date
  repeat: RepeatType;
  days?: number[] | null; // weekday indices 0=Sun..6=Sat (weekly only)
  time: string;
  duration?: number | null;
  title: string;
  sub?: string; // web detail field
  categories?: string[];
  poster?: string;
  priority?: Priority;
  skips?: string[]; // dateKeys skipped
};

/** Does a recurring template fall on the given dateKey? (mirrors web recurMatches) */
export function recurMatches(tpl: Recurring, key: string): boolean {
  if (!tpl.anchor || key < tpl.anchor) return false;
  if (Array.isArray(tpl.skips) && tpl.skips.includes(key)) return false;
  const d = new Date(key + 'T00:00:00');
  const a = new Date(tpl.anchor + 'T00:00:00');
  const dow = d.getDay();
  switch (tpl.repeat) {
    case 'daily':
      return true;
    case 'weekdays':
      return dow >= 1 && dow <= 5;
    case 'weekends':
      return dow === 0 || dow === 6;
    case 'weekly':
      return tpl.days && tpl.days.length ? tpl.days.includes(dow) : dow === a.getDay();
    case 'monthly':
      return d.getDate() === a.getDate();
    case 'yearly':
      return d.getDate() === a.getDate() && d.getMonth() === a.getMonth();
  }
  return false;
}

/** Virtual recurring instances for a day (not yet persisted). */
export function recurringForDay(bundle: Bundle | null, key: string): Task[] {
  const list = (bundle?.recurring ?? []) as Recurring[];
  if (!list.length) return [];
  const dayTasks = bundle?.days?.[key]?.tasks ?? [];
  const out: Task[] = [];
  for (const r of list) {
    if (!recurMatches(r, key)) continue;
    if (dayTasks.some((t) => t.recurId === r.id)) continue;
    out.push({
      id: `${r.id}@${key}`,
      recurId: r.id,
      title: r.title,
      time: r.time,
      duration: r.duration ?? undefined,
      categories: r.categories,
      priority: r.priority,
      note: r.sub,
      repeat: r.repeat,
      repeatDays: r.days ?? undefined,
    });
  }
  return out;
}

/** Turn a virtual recurring instance into a real persisted task on the day. */
export function materializeRecur(b: Bundle, key: string, recurId: string): Task | null {
  const r = ((b.recurring ?? []) as Recurring[]).find((x) => x.id === recurId);
  if (!r) return null;
  if (!b.days[key]) b.days[key] = { tasks: [] };
  const existing = b.days[key].tasks.find((t) => t.recurId === recurId);
  if (existing) return existing;
  const t: Task = {
    id: genId(),
    recurId,
    title: r.title,
    time: r.time,
    duration: r.duration ?? undefined,
    categories: r.categories,
    priority: r.priority,
    note: r.sub,
    repeat: r.repeat,
    repeatDays: r.days ?? undefined,
    createdAt: Date.now(),
  };
  b.days[key].tasks.push(t);
  return t;
}

export function skipRecur(b: Bundle, key: string, recurId: string): void {
  const r = ((b.recurring ?? []) as Recurring[]).find((x) => x.id === recurId);
  if (!r) return;
  if (!Array.isArray(r.skips)) r.skips = [];
  if (!r.skips.includes(key)) r.skips.push(key);
}

/** Create/update/remove a recurring template for a task (mirrors web handleRecurrence). */
export function handleRecurrence(
  b: Bundle,
  task: Task,
  repeat: RepeatType | 'none',
  days: number[] | null,
  startKey: string,
  currentKey: string,
): void {
  if (!b.recurring) b.recurring = [];
  const tpls = b.recurring as Recurring[];
  if (repeat && repeat !== 'none') {
    const anchor = startKey || currentKey;
    const dayArr =
      repeat === 'weekly'
        ? days && days.length
          ? [...days].sort((a, c) => a - c)
          : [new Date(anchor + 'T00:00:00').getDay()]
        : null;
    if (task.recurId) {
      const tpl = tpls.find((x) => x.id === task.recurId);
      if (tpl) {
        tpl.time = task.time;
        tpl.duration = task.duration ?? null;
        tpl.title = task.title;
        tpl.sub = task.note;
        tpl.categories = task.categories;
        tpl.priority = task.priority;
        tpl.repeat = repeat;
        tpl.days = dayArr;
        tpl.anchor = anchor;
      }
      task.repeat = repeat;
      task.repeatDays = dayArr ?? undefined;
    } else {
      const id = 'tpl' + Date.now() + Math.random().toString(36).slice(2, 5);
      task.recurId = id;
      task.repeat = repeat;
      task.repeatDays = dayArr ?? undefined;
      tpls.push({
        id,
        anchor,
        repeat,
        days: dayArr,
        time: task.time,
        duration: task.duration ?? null,
        title: task.title,
        sub: task.note,
        categories: task.categories,
        priority: task.priority,
        skips: [],
      });
    }
  } else if (task.recurId) {
    const i = tpls.findIndex((x) => x.id === task.recurId);
    if (i >= 0) tpls.splice(i, 1);
    delete task.recurId;
    delete task.repeat;
    delete task.repeatDays;
  }
}

// ---- Mutations (mirror the web task actions) ----
export function genId(): string {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Append an activity entry to the bundle's history log (most recent first, capped). */
export function logActivity(
  b: Bundle,
  type: string,
  task: { title?: string; time?: string },
  day: string,
  detail?: string,
): void {
  if (!Array.isArray(b.activity)) b.activity = [];
  b.activity.unshift({
    id: genId(),
    ts: Date.now(),
    type,
    title: task.title || 'Task',
    time: task.time,
    day,
    detail,
  });
  if (b.activity.length > 300) b.activity.length = 300;
}

/** Record a move/reschedule/swap change on a task (mirrors the web recordChange). */
export function recordChange(
  t: Task,
  type: 'moved' | 'rescheduled' | 'swapped',
  fromTime: string,
  toTime: string,
  fromKey?: string,
  toKey?: string,
): void {
  if (!t.origTime) t.origTime = fromTime;
  if (!t.origKey && fromKey) t.origKey = fromKey;
  if (!Array.isArray(t.changes)) t.changes = [];
  const rec: TaskChange = { type, from: fromTime, to: toTime, at: Date.now() };
  if (fromKey) rec.fromKey = fromKey;
  if (toKey) rec.toKey = toKey;
  t.changes.push(rec);
}

export function changeCounts(t: Task): { moved: number; rescheduled: number; swapped: number } {
  const c = { moved: 0, rescheduled: 0, swapped: 0 };
  (t.changes || []).forEach((x) => {
    if ((c as any)[x.type] != null) (c as any)[x.type]++;
  });
  return c;
}

export function newTask(p: {
  title: string;
  time: string;
  duration?: number;
  categories?: string[];
  priority?: Priority;
  note?: string;
}): Task {
  return {
    id: genId(),
    title: p.title.trim(),
    time: p.time,
    duration: p.duration ?? 30,
    categories: p.categories ?? [],
    priority: p.priority ?? 'medium',
    note: p.note?.trim() || undefined,
    createdAt: Date.now(),
  };
}

export function startTask(t: Task): void {
  t.startedAt = Date.now();
  t.runningSince = Date.now();
  t.accumMs = 0;
  delete t.completedAt;
  delete t.pausedAccumMs;
  delete t.pausedSince;
  t.done = false;
}

export function pauseRunning(t: Task): void {
  if (t.runningSince) {
    t.accumMs = (t.accumMs || 0) + (Date.now() - t.runningSince);
    t.runningSince = null;
  }
  t.pausedSince = Date.now();
}

export function resumeTask(t: Task): void {
  if (t.pausedSince) {
    t.pausedAccumMs = (t.pausedAccumMs || 0) + (Date.now() - t.pausedSince);
    delete t.pausedSince;
  }
  t.runningSince = Date.now();
}

export function completeTask(t: Task): void {
  if (t.runningSince) {
    t.accumMs = (t.accumMs || 0) + (Date.now() - t.runningSince);
    t.runningSince = null;
  }
  if (t.pausedSince) {
    t.pausedAccumMs = (t.pausedAccumMs || 0) + (Date.now() - t.pausedSince);
    delete t.pausedSince;
  }
  t.completedAt = Date.now();
  t.done = true;
}

export function cancelTask(t: Task): void {
  t.cancelled = true;
  delete t.runningSince;
  delete t.pausedSince;
}

export function resetTask(t: Task): void {
  t.done = false;
  delete t.startedAt;
  delete t.completedAt;
  delete t.accumMs;
  delete t.runningSince;
  delete t.pausedAccumMs;
  delete t.pausedSince;
  delete t.cancelled;
  delete t.carried;
}

// ---- Conflict detection (for moves) ----
function overlaps(aStart: number, aDur: number, bStart: number, bDur: number): boolean {
  const aEnd = aStart + Math.max(aDur, 1);
  const bEnd = bStart + Math.max(bDur, 1);
  return aStart < bEnd && bStart < aEnd;
}

/** Tasks on `dayTasks` that overlap the given time/duration, excluding ids. */
export function conflictsOnDay(
  time: string,
  duration: number | undefined,
  dayTasks: Task[],
  excludeIds: Set<string>,
): Task[] {
  const s = timeToMinutes(time);
  const d = duration || 0;
  return dayTasks.filter((o) => {
    if (excludeIds.has(o.id)) return false;
    const st = taskState(o);
    if (st === 'cancelled' || st === 'carried') return false;
    return overlaps(s, d, timeToMinutes(o.time), o.duration || 0);
  });
}

// ---- Day window + free slots (mirror web: 7:30am .. 10:30pm) ----
export const SLEEP_END = 450; // 7:30am in minutes
export const AWAKE_END = 1350; // 10:30pm in minutes

export function minToTime(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(m / 60))}:${p(m % 60)}`;
}

export function freeGaps(tasks: Task[]): [number, number][] {
  const blocks: [number, number][] = [];
  tasks.forEach((t) => {
    const st = taskState(t);
    if (st === 'cancelled' || st === 'carried') return;
    const d = t.duration || 0;
    if (d <= 0) return;
    const s = timeToMinutes(t.time);
    blocks.push([Math.max(s, SLEEP_END), Math.min(s + d, AWAKE_END)]);
  });
  blocks.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  blocks.forEach((b) => {
    if (b[1] <= b[0]) return;
    const last = merged[merged.length - 1];
    if (last && b[0] <= last[1]) last[1] = Math.max(last[1], b[1]);
    else merged.push([b[0], b[1]]);
  });
  const gaps: [number, number][] = [];
  let cur = SLEEP_END;
  merged.forEach((b) => {
    if (b[0] - cur >= 15) gaps.push([cur, b[0]]);
    cur = Math.max(cur, b[1]);
  });
  if (AWAKE_END - cur >= 15) gaps.push([cur, AWAKE_END]);
  return gaps;
}

export type DayStats = {
  count: number;
  plannedMin: number;
  freeMin: number;
  endMin: number | null;
};

export function dayStats(tasks: Task[]): DayStats {
  let plannedMin = 0;
  let lastEnd: number | null = null;
  tasks.forEach((t) => {
    plannedMin += t.duration || 0;
    const end = timeToMinutes(t.time) + (t.duration || 0);
    if (lastEnd === null || end > lastEnd) lastEnd = end;
  });
  const firstStart = tasks.length ? timeToMinutes(sortByTime(tasks)[0].time) : 0;
  const windowMin = lastEnd !== null ? lastEnd - firstStart : 0;
  const freeMin = Math.max(0, windowMin - plannedMin);
  return { count: tasks.length, plannedMin, freeMin, endMin: lastEnd };
}


