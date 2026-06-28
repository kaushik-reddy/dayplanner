import DateTimePicker from '@react-native-community/datetimepicker';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState, memo } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  type Bundle,
  type Priority,
  type Task,
  AWAKE_END,
  cancelTask,
  catColor,
  completeTask,
  conflictsOnDay,
  dateKey,
  dayStats,
  fmtDuration,
  fmtTime,
  freeGaps,
  genId,
  getCategories,
  handleRecurrence,
  isActive,
  isPaused,
  logActivity,
  materializeRecur,
  minToTime,
  newTask,
  pauseRunning,
  prioMeta,
  type RepeatType,
  recordChange,
  changeCounts,
  type TaskChange,
  resetTask,
  resumeTask,
  skipRecur,
  startTask,
  tasksForDay,
  taskState,
  timeToMinutes,
} from '../lib/planner';
import { usePlanner } from '../lib/usePlanner';
import BookingsView from '../components/BookingsView';
import AuditView from '../components/AuditView';
import { manageBooking } from '../lib/bookings';
import { LiveActivity } from '../../modules/live-activity';

const C = {
  bg: '#0A0A0B',
  bgSoft: '#131315',
  card: '#17161A',
  ink: '#F5F3EF',
  inkDim: '#9A968D',
  inkFaint: '#5C5954',
  line: '#242326',
  brass: '#C9974A',
  brassSoft: 'rgba(201,151,74,0.16)',
  green: '#6FA88A',
  red: '#C97A6A',
};
const F = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
  xbold: 'Poppins_800ExtraBold',
};

const CAT_SYMBOL: Record<string, string> = {
  work: 'bolt.fill',
  watch: 'play.tv.fill',
  read: 'book.fill',
  sleep: 'moon.fill',
  errand: 'bag.fill',
  meeting: 'person.2.fill',
  general: 'circle.fill',
};
const ALL_CATS = ['work', 'watch', 'read', 'sleep', 'errand', 'general'];
const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'must'];
const DURATIONS = [15, 30, 45, 60, 90, 120];

function taskSymbol(t: Task): string {
  for (const c of getCategories(t)) if (CAT_SYMBOL[c]) return CAT_SYMBOL[c];
  return 'circle.fill';
}
function taskAccent(t: Task): string {
  const cats = getCategories(t);
  return cats.length ? catColor(cats[0]) : C.brass;
}

function taskToLiveActivity(t: Task, date: Date) {
  const [h, m] = (t.time || '0:0').split(':').map(Number);
  const start = new Date(date);
  start.setHours(h, m, 0, 0);
  const dur = (t.duration && t.duration > 0 ? t.duration : 30) * 60000;
  const cats = getCategories(t);
  return {
    taskId: t.id,
    title: t.title,
    subtitle: cats.length ? cats.join(' · ') : 'Day Planner',
    symbol: taskSymbol(t),
    accentHex: taskAccent(t),
    startEpoch: Math.floor(start.getTime() / 1000),
    endEpoch: Math.floor((start.getTime() + dur) / 1000),
    priority: (t.priority as Priority) ?? 'medium',
    isRunning: taskState(t) === 'running',
  };
}
function sameDay(a: Date, b: Date): boolean {
  return dateKey(a) === dateKey(b);
}
function dayName(d: Date): string {
  const today = new Date();
  const diff = Math.round(
    (new Date(dateKey(d)).getTime() - new Date(dateKey(today)).getTime()) / 86400000,
  );
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long' });
}
function pad(n: number) {
  return String(n).padStart(2, '0');
}
function prioColor(p?: Priority) {
  return p === 'must' ? '#D9645A' : p === 'high' ? '#E0915A' : p === 'medium' ? '#C9974A' : '#7FA8C9';
}
function fmtDateLabel(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
}

function PriorityBars({ priority }: { priority?: Priority }) {
  const meta = prioMeta(priority);
  if (!meta) return null;
  const color = prioColor(priority);
  const heights = [5, 8, 11, 14];
  return (
    <View style={styles.prioWrap}>
      {[1, 2, 3, 4].map((i) => (
        <View
          key={i}
          style={[
            styles.prioBar,
            { height: heights[i - 1] },
            { backgroundColor: i <= meta.n ? color : 'rgba(245,243,239,0.14)' },
          ]}
        />
      ))}
      <Text style={[styles.prioLbl, { color }]}>{meta.label}</Text>
    </View>
  );
}

function StateBadge({ task }: { task: Task }) {
  const st = taskState(task);
  if (st === 'running' && isPaused(task))
    return <Text style={[styles.pill, styles.pillPause]}>PAUSED</Text>;
  if (st === 'cancelled') return <Text style={[styles.pill, styles.pillCancel]}>CANCELLED</Text>;
  if (st === 'carried') return <Text style={[styles.pill, styles.pillCarry]}>CARRIED</Text>;
  return null;
}

function repeatLabel(t: Task): string {
  const r = t.repeat as string | undefined;
  if (!r || r === 'none') return t.recurId ? 'Repeats' : '';
  if (r === 'daily') return 'Repeats daily';
  if (r === 'weekdays') return 'Weekdays';
  if (r === 'weekends') return 'Weekends';
  if (r === 'monthly') return 'Monthly';
  if (r === 'yearly') return 'Yearly';
  if (r === 'weekly') {
    const days = Array.isArray(t.repeatDays) ? (t.repeatDays as number[]) : [];
    if (!days.length) return 'Weekly';
    const D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days
      .slice()
      .sort((a, b) => a - b)
      .map((d) => D[d])
      .join(' ');
  }
  return 'Repeats';
}

// Rotated rail time, isolated + memoized so the per-second `now` tick on a
// running row never re-renders (and thus never flickers/flips) the vertical time.
const RailTime = memo(
  function RailTime({ time, color }: { time: string; color: string }) {
    // iOS occasionally paints the rotated text un-rotated on the very first frame (then it only
    // corrects on a later re-render, e.g. after navigating). Hide it for the first frame and reveal
    // it once mounted so the user only ever sees it correctly vertical — never a horizontal flash.
    const [ready, setReady] = useState(false);
    useEffect(() => {
      const id = requestAnimationFrame(() => setReady(true));
      return () => cancelAnimationFrame(id);
    }, []);
    return (
      <View style={styles.timeWrap} pointerEvents="none">
        <Text numberOfLines={1} style={[styles.timeV, { color, opacity: ready ? 1 : 0 }]}>
          {fmtTime(time)}
        </Text>
      </View>
    );
  },
  (p, n) => p.time === n.time && p.color === n.color,
);

// "moved 2× · resch 1×" style summary for the change badge
function changeSummary(cc: { moved: number; rescheduled: number; swapped: number }): string {
  const parts: string[] = [];
  if (cc.moved) parts.push(`moved ${cc.moved}×`);
  if (cc.rescheduled) parts.push(`resch ${cc.rescheduled}×`);
  if (cc.swapped) parts.push(`swap ${cc.swapped}×`);
  return parts.join(' · ');
}

// "2h 15m" / "15m" / "45s" / "3d 5h" — compact countdown formatter
function fmtCountShort(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${sec}s`;
}

function TaskRow({
  task,
  onPress,
  selectMode,
  selected,
  now,
  isToday,
  compact,
  dayStartMs,
  onHistory,
}: {
  task: Task;
  onPress: () => void;
  selectMode?: boolean;
  selected?: boolean;
  now: number;
  isToday: boolean;
  compact?: boolean;
  dayStartMs: number;
  onHistory?: (t: Task) => void;
}) {
  const st = taskState(task);
  const done = st === 'completed';
  const running = st === 'running' && !isPaused(task);
  const dim = done || st === 'cancelled' || st === 'carried';
  const cats = getCategories(task);
  const elapsedSec =
    ((task.accumMs || 0) + (task.runningSince ? now - task.runningSince : 0)) / 1000;
  const nowDate = new Date(now);
  const curMin = nowDate.getHours() * 60 + nowDate.getMinutes();
  const overdue = isToday && st === 'pending' && timeToMinutes(task.time) < curMin;
  const repeatLbl = repeatLabel(task);
  const endTotalMin = timeToMinutes(task.time) + (task.duration || 0);
  const endsAt = task.duration
    ? fmtTime(minToTime(endTotalMin)) + (endTotalMin >= 1440 ? ` +${Math.floor(endTotalMin / 1440)}d` : '')
    : '';
  const spentPct = running
    ? Math.min(100, Math.round((elapsedSec * 1000) / ((task.duration || 30) * 60000) * 100))
    : 0;

  const dotStyle = done
    ? { backgroundColor: C.green, borderColor: C.green }
    : running
      ? { backgroundColor: C.brass, borderColor: C.brass }
      : overdue
        ? { backgroundColor: C.bg, borderColor: C.red }
        : { backgroundColor: C.bg, borderColor: C.inkFaint };
  const timeColor = done ? C.green : running ? C.brass : overdue ? C.red : C.inkDim;
  const cc = changeCounts(task);
  const changeTotal = cc.moved + cc.rescheduled + cc.swapped;

  // Per-task live countdown (until start, or how late) — shown on every pending row.
  const startMs = dayStartMs + timeToMinutes(task.time) * 60000;
  const untilMs = startMs - now;
  let countdown = '';
  let countdownLate = false;
  if (!dim && !running) {
    if (untilMs > 0) countdown = 'in ' + fmtCountShort(untilMs);
    else {
      countdown = fmtCountShort(-untilMs) + ' late';
      countdownLate = true;
    }
  }

  return (
    <View style={styles.task}>
      <View style={styles.dotCol}>
        <View style={styles.rail} />
        <View style={[styles.dot, dotStyle, running && styles.dotGlow]} />
        <RailTime time={task.time} color={timeColor} />
      </View>

      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.taskCard,
          running && styles.taskCardActive,
          done && styles.taskCardDone,
          compact && !running && styles.taskCardFocus,
          selectMode && selected && styles.taskCardSelected,
          pressed && !selectMode && { borderColor: C.brass, transform: [{ scale: 0.99 }] },
        ]}>
        {selectMode && (
          <View style={[styles.selBox, selected && styles.selBoxOn]}>
            {selected && (
              <SymbolView name="checkmark" size={12} tintColor={C.bg} fallback={<Text>✓</Text>} />
            )}
          </View>
        )}
        <View style={styles.taskBody}>
          <View style={styles.titleRow}>
            <Text
              style={[
                styles.taskTitle,
                dim && { color: C.inkDim },
                (done || st === 'cancelled') && styles.strike,
              ]}
              numberOfLines={2}>
              {task.title}
            </Text>
            <PriorityBars priority={task.priority} />
          </View>
          <View style={styles.subRow}>
            {!!countdown && (
              <View style={[styles.countChip, countdownLate && styles.countChipLate]}>
                <SymbolView
                  name={countdownLate ? 'exclamationmark.circle.fill' : 'timer'}
                  size={10}
                  tintColor={countdownLate ? C.red : C.brass}
                  fallback={<Text style={{ color: countdownLate ? C.red : C.brass }}>⏱</Text>}
                />
                <Text style={[styles.countText, countdownLate && { color: C.red }]}>{countdown}</Text>
              </View>
            )}
            {cats.map((c) => (
              <View key={c} style={styles.catChip}>
                <View style={[styles.catDot, { backgroundColor: catColor(c) }]} />
                <Text style={styles.catText}>{c}</Text>
              </View>
            ))}
            {!!task.duration && <Text style={styles.metaText}>{fmtDuration(task.duration)}</Text>}
            {st === 'running' && (
              <Text style={[styles.liveTimer, isPaused(task) && { color: '#D9A85C' }]}>
                {fmtClock(elapsedSec)}
              </Text>
            )}
            <StateBadge task={task} />
          </View>
          {(repeatLbl || endsAt) && !dim && (
            <View style={styles.metaLine}>
              {!!repeatLbl && (
                <View style={styles.metaPiece}>
                  <SymbolView name="repeat" size={10} tintColor="#9C8FD0" fallback={<Text style={{ color: '#9C8FD0' }}>↻</Text>} />
                  <Text style={[styles.metaLineText, { color: '#9C8FD0' }]}>{repeatLbl}</Text>
                </View>
              )}
              {!!endsAt && (
                <View style={styles.metaPiece}>
                  <SymbolView name="arrow.down.to.line" size={10} tintColor={C.inkFaint} fallback={<Text style={{ color: C.inkFaint }}>↓</Text>} />
                  <Text style={styles.metaLineText}>Ends ~{endsAt}</Text>
                </View>
              )}
            </View>
          )}
          {changeTotal > 0 && (
            <Pressable
              onPress={() => onHistory?.(task)}
              hitSlop={6}
              style={({ pressed }) => [styles.changeRow, pressed && { borderColor: C.blue, opacity: 0.85 }]}>
              <SymbolView name="clock.arrow.circlepath" size={11} tintColor={C.blue} fallback={<Text style={{ color: C.blue }}>↻</Text>} />
              <Text style={styles.changeRowText}>{changeSummary(cc)}</Text>
              <SymbolView name="chevron.right" size={9} tintColor={C.blue} fallback={<Text style={{ color: C.blue }}>›</Text>} />
            </Pressable>
          )}
          {running && (
            <DottedBar progress={spentPct / 100} color={spentPct >= 100 ? C.red : C.brass} ticks={44} height={5} mt={10} />
          )}
          {!!task.note && (
            <Text style={styles.taskNote} numberOfLines={2}>
              {task.note}
            </Text>
          )}
        </View>
      </Pressable>
    </View>
  );
}

// Memoized so the per-second `now` tick only re-renders the rows that need it.
// This stops the rotated rail time from flashing/flipping on unrelated rows.
const TaskRowMemo = memo(TaskRow, (prev, next) => {
  if (
    prev.task !== next.task ||
    prev.selectMode !== next.selectMode ||
    prev.selected !== next.selected ||
    prev.compact !== next.compact ||
    prev.isToday !== next.isToday ||
    prev.dayStartMs !== next.dayStartMs
  )
    return false;
  const st = taskState(next.task);
  const running = st === 'running' && !isPaused(next.task);
  if (running) return prev.now === next.now; // running rows tick every second
  if (st === 'pending') {
    // pending rows show a live countdown: tick per second when within 2 min of the start
    // (so seconds count down smoothly), otherwise per minute to stay light.
    const startMs = next.dayStartMs + timeToMinutes(next.task.time) * 60000;
    if (Math.abs(startMs - next.now) < 120000) return prev.now === next.now;
    return Math.floor(prev.now / 60000) === Math.floor(next.now / 60000);
  }
  return true; // done/cancelled/carried rows ignore the tick entirely
});

function pickFocus(tasks: Task[], isToday: boolean): Task | null {
  const running = tasks.find((t) => isActive(t));
  if (running) return running;
  const pending = tasks
    .filter((t) => taskState(t) === 'pending')
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  if (!pending.length) return null;
  if (!isToday) return pending[0];
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const overdue = pending.filter((t) => timeToMinutes(t.time) < nowMin);
  // the latest task whose start time has passed = the slot you should be on now
  if (overdue.length) return overdue[overdue.length - 1];
  return pending[0];
}

function ClockCol({ value, label, brass }: { value: number; label: string; brass?: boolean }) {
  return (
    <View style={styles.heroCol}>
      <Text style={[styles.heroNum, value === 0 && styles.heroNumZero, brass && { color: C.brass }]}>
        {String(value).padStart(2, '0')}
      </Text>
      <Text style={styles.heroUnitLabel}>{label}</Text>
    </View>
  );
}

function ClockSep() {
  return (
    <View style={styles.heroSepCol}>
      <Text style={styles.heroSep}>:</Text>
    </View>
  );
}

function DottedBar({
  progress,
  color,
  ticks = 28,
  height = 8,
  mt = 16,
}: {
  progress: number;
  color: string;
  ticks?: number;
  height?: number;
  mt?: number;
}) {
  const filled = Math.max(0, Math.min(ticks, Math.round(progress * ticks)));
  return (
    <View style={[styles.dottedBar, { marginTop: mt }]}>
      {Array.from({ length: ticks }).map((_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height,
            borderRadius: 1,
            backgroundColor: i < filled ? color : 'rgba(255,255,255,0.1)',
          }}
        />
      ))}
    </View>
  );
}

function Hero({
  focus,
  isToday,
  date,
  now,
}: {
  focus: Task | null;
  isToday: boolean;
  date: Date;
  now: number;
}) {
  if (!focus) {
    return (
      <View style={[styles.hero, styles.heroEmptyWrap]}>
        <SymbolView
          name="moon.stars.fill"
          size={30}
          tintColor={C.brass}
          fallback={<Text style={{ color: C.brass, fontSize: 26 }}>☾</Text>}
        />
        <Text style={styles.heroEmptyTitle}>
          {isToday ? 'Nothing scheduled' : 'No tasks this day'}
        </Text>
        <Text style={styles.heroEmptySub}>
          {isToday ? 'Enjoy the calm — tap + to add one.' : 'Tap + to plan this day.'}
        </Text>
      </View>
    );
  }
  const running = isActive(focus);
  const [h, m] = focus.time.split(':').map(Number);
  const start = new Date(date);
  start.setHours(h, m, 0, 0);
  const durMs = (focus.duration && focus.duration > 0 ? focus.duration : 30) * 60000;
  const overdue = isToday && !running && start.getTime() < now;

  let totalSec = -1;
  let label = 'UP NEXT';
  let subLabel = 'until it starts';
  let live = false;
  let progress = 0;
  let accent = taskAccent(focus);
  if (isToday && running && focus.startedAt) {
    const elapsed = now - focus.startedAt;
    totalSec = Math.max(0, Math.floor(elapsed / 1000));
    label = 'HAPPENING NOW';
    subLabel = 'in progress';
    live = true;
    progress = Math.min(1, elapsed / durMs);
    accent = C.green;
  } else if (overdue) {
    const late = now - start.getTime();
    totalSec = Math.max(0, Math.floor(late / 1000));
    label = 'DELAYED';
    subLabel = 'running late';
    live = true;
    progress = Math.min(1, late / durMs);
    accent = C.red;
  } else if (start.getTime() > now) {
    // Upcoming — works for today AND future days (counts down across days).
    const until = start.getTime() - now;
    totalSec = Math.max(0, Math.floor(until / 1000));
    label = isToday ? 'UP NEXT' : 'UPCOMING';
    subLabel = 'until it starts';
    accent = taskAccent(focus);
    // The dotted bar DEPLETES as the start approaches (full when far, empty at start) —
    // a countdown feel, opposite of the running task bar which fills with elapsed time.
    const dayStart = new Date(start);
    dayStart.setHours(0, 0, 0, 0);
    const windowMs = Math.max(durMs, start.getTime() - dayStart.getTime());
    progress = Math.min(1, Math.max(0, until / windowMs));
  } else {
    label = 'SCHEDULED';
    accent = taskAccent(focus);
  }
  const dd = totalSec >= 0 ? Math.floor(totalSec / 86400) : 0;
  const hh = totalSec >= 0 ? Math.floor((totalSec % 86400) / 3600) : 0;
  const mm = totalSec >= 0 ? Math.floor((totalSec % 3600) / 60) : 0;
  const ss = totalSec >= 0 ? totalSec % 60 : 0;

  return (
    <View style={styles.hero}>
      <LinearGradient
        colors={[accent + '2E', accent + '0F', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1.15 }}
        style={styles.heroBg}
      />
      <LinearGradient
        colors={['rgba(255,255,255,0.05)', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 0.4 }}
        style={styles.heroSheen}
      />
      <View style={styles.heroInner}>
        <View style={styles.heroTop}>
          <View style={styles.heroEyebrow}>
            <View style={[styles.heroPulse, { backgroundColor: accent, shadowColor: accent }]} />
            <Text style={[styles.heroEyebrowText, { color: accent }]}>{label}</Text>
          </View>
          <PriorityBars priority={focus.priority} />
        </View>
        <Text style={styles.heroTitle} numberOfLines={2}>
          {focus.title}
        </Text>
        {totalSec >= 0 ? (
          <>
            <View style={styles.heroClock}>
              <ClockCol value={dd} label="DAYS" />
              <ClockSep />
              <ClockCol value={hh} label="HRS" />
              <ClockSep />
              <ClockCol value={mm} label="MIN" />
              <ClockSep />
              <ClockCol value={ss} label="SEC" brass />
            </View>
            <DottedBar progress={progress} color={accent} ticks={64} height={9} />
            <Text style={styles.heroFootText}>
              {subLabel} · {fmtTime(focus.time)}
              {focus.duration ? ` · ${fmtDuration(focus.duration)}` : ''}
            </Text>
          </>
        ) : (
          <Text style={styles.heroMetaBig}>Scheduled at {fmtTime(focus.time)}</Text>
        )}
      </View>
    </View>
  );
}

function DayProgress({
  tasks,
  now,
  isToday,
  onPress,
}: {
  tasks: Task[];
  now: number;
  isToday: boolean;
  onPress?: (t: Task) => void;
}) {
  const active = tasks.filter((t) => {
    const s = taskState(t);
    return s !== 'cancelled' && s !== 'carried';
  });
  const done = active.filter((t) => taskState(t) === 'completed').length;
  const total = active.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const nowDate = new Date(now);
  const curMin = nowDate.getHours() * 60 + nowDate.getMinutes();
  return (
    <View style={styles.dayProgress}>
      <View style={styles.segBar}>
        {active.length === 0 ? (
          <View style={styles.seg} />
        ) : (
          active.map((t, i) => {
            const st = taskState(t);
            const run = st === 'running' && !isPaused(t);
            const paused = st === 'running' && isPaused(t);
            const over = isToday && st === 'pending' && timeToMinutes(t.time) < curMin;
            const fill =
              st === 'completed'
                ? C.green
                : run
                  ? C.brass
                  : paused
                    ? C.amber
                    : over
                      ? C.red
                      : null;
            return (
              <Pressable key={t.id + i} style={styles.seg} onPress={() => onPress?.(t)} hitSlop={6}>
                <View
                  style={[
                    styles.segFill,
                    fill
                      ? { width: '100%', backgroundColor: fill, opacity: st === 'completed' || run ? 1 : 0.55 }
                      : { width: '0%' },
                  ]}
                />
              </Pressable>
            );
          })
        )}
      </View>
      <View style={styles.dayMeta}>
        <Text style={styles.dayCount}>
          <Text style={{ color: C.ink, fontFamily: F.semibold }}>{done}</Text> of {total} done
        </Text>
        <Text style={styles.dayCount}>{pct}%</Text>
      </View>
    </View>
  );
}

type ViewKey = 'planner' | 'bookings' | 'audit';
function ViewTabs({ value, onChange }: { value: ViewKey; onChange: (v: ViewKey) => void }) {
  const tabs: { key: ViewKey; label: string }[] = [
    { key: 'planner', label: 'Planner' },
    { key: 'bookings', label: 'Bookings' },
    { key: 'audit', label: 'Audit' },
  ];
  return (
    <View style={styles.viewtabs}>
      {tabs.map((t) => (
        <Pressable
          key={t.key}
          onPress={() => onChange(t.key)}
          style={[styles.viewtab, value === t.key && styles.viewtabActive]}>
          <Text style={[styles.viewtabText, value === t.key && styles.viewtabTextActive]}>
            {t.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function NavBtn({ onPress, icon, dot }: { onPress: () => void; icon: string; dot?: string }) {
  return (
    <Pressable style={styles.navBtn} onPress={onPress} hitSlop={6}>
      <SymbolView
        name={icon as any}
        size={17}
        tintColor={C.inkDim}
        fallback={<Text style={{ color: C.inkDim }}>•</Text>}
      />
      {dot && <View style={[styles.navDot, { backgroundColor: dot }]} />}
    </Pressable>
  );
}

function BottomBar({
  value,
  onChange,
  bottom,
}: {
  value: ViewKey;
  onChange: (v: ViewKey) => void;
  bottom: number;
}) {
  const items: { key: ViewKey; label: string; icon: string }[] = [
    { key: 'planner', label: 'Planner', icon: 'calendar.day.timeline.left' },
    { key: 'bookings', label: 'Bookings', icon: 'person.2.fill' },
    { key: 'audit', label: 'Audit', icon: 'chart.bar.fill' },
  ];
  return (
    <View style={[styles.bottomWrap, { bottom }]} pointerEvents="box-none">
      <BlurView intensity={28} tint="dark" style={styles.bottomPill}>
        {items.map((it) => {
          const on = value === it.key;
          return (
            <Pressable
              key={it.key}
              style={styles.pillTab}
              onPress={() => onChange(it.key)}
              hitSlop={4}>
              {on && (
                <LinearGradient
                  colors={['#E0B36A', '#C9974A']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.pillTabOnBg}
                />
              )}
              <SymbolView
                name={it.icon as any}
                size={15}
                tintColor={on ? C.bg : C.inkDim}
                fallback={<Text style={{ color: on ? C.bg : C.inkDim }}>•</Text>}
              />
              <Text style={[styles.pillTabText, on && styles.pillTabTextOn]}>{it.label}</Text>
            </Pressable>
          );
        })}
      </BlurView>
    </View>
  );
}

// ---------- Task action sheet ----------
function ActionSheet({
  task,
  onClose,
  onAction,
  onDelete,
  onEdit,
  onMove,
  onCarry,
}: {
  task: Task | null;
  onClose: () => void;
  onAction: (fn: (t: Task) => void) => void;
  onDelete: () => void;
  onEdit: () => void;
  onMove: () => void;
  onCarry: () => void;
}) {
  if (!task) return null;
  const st = taskState(task);
  const paused = isPaused(task);
  const act = (fn: (t: Task) => void) => {
    onAction(fn);
    onClose();
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { maxHeight: '86%' }]}>
          <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle} numberOfLines={3}>
            {task.title}
          </Text>
          <Text style={styles.sheetSub}>
            {fmtTime(task.time)}
            {task.duration ? ` · ${fmtDuration(task.duration)}` : ''}
          </Text>
          {!!task.note && <Text style={styles.sheetNote}>{task.note}</Text>}

          <View style={styles.detailMeta}>
            {prioMeta(task.priority) && (
              <View style={styles.detailChip}>
                <View style={[styles.detailDot, { backgroundColor: prioColor(task.priority) }]} />
                <Text style={[styles.detailChipText, { color: prioColor(task.priority) }]}>
                  {prioMeta(task.priority)!.label}
                </Text>
              </View>
            )}
            {getCategories(task).map((c) => (
              <View key={c} style={styles.detailChip}>
                <View style={[styles.detailDot, { backgroundColor: catColor(c) }]} />
                <Text style={styles.detailChipText}>{c}</Text>
              </View>
            ))}
            {!!task.recurId && (
              <View style={styles.detailChip}>
                <SymbolView name="repeat" size={11} tintColor="#9C8FD0" fallback={<Text style={{ color: '#9C8FD0' }}>↻</Text>} />
                <Text style={[styles.detailChipText, { color: '#9C8FD0' }]}>Repeats</Text>
              </View>
            )}
          </View>
          {(st === 'running' || st === 'completed' || (task.accumMs || 0) > 0) && (
            <Text style={styles.detailTracked}>
              Tracked{' '}
              {fmtClock(
                ((task.accumMs || 0) + (task.runningSince ? Date.now() - task.runningSince : 0)) /
                  1000,
              )}
              {task.duration ? ` of ${fmtDuration(task.duration)}` : ''}
            </Text>
          )}

          <View style={styles.sheetActions}>
            {st === 'pending' && (
              <SheetBtn icon="play.fill" label="Start" onPress={() => act(startTask)} primary />
            )}
            {st === 'running' && !paused && (
              <SheetBtn icon="pause.fill" label="Pause" onPress={() => act(pauseRunning)} />
            )}
            {st === 'running' && paused && (
              <SheetBtn icon="play.fill" label="Resume" onPress={() => act(resumeTask)} primary />
            )}
            {st !== 'completed' && st !== 'cancelled' && (
              <SheetBtn icon="checkmark" label="Complete" onPress={() => act(completeTask)} green />
            )}
            <SheetBtn
              icon="pencil"
              label="Edit"
              onPress={() => {
                onEdit();
                onClose();
              }}
            />
            <SheetBtn
              icon="calendar"
              label="Move / reschedule"
              onPress={() => {
                onMove();
                onClose();
              }}
            />
            {st !== 'completed' && st !== 'cancelled' && st !== 'carried' && (
              <SheetBtn
                icon="arrow.uturn.forward"
                label="Carry to tomorrow"
                onPress={() => {
                  onCarry();
                  onClose();
                }}
              />
            )}
            {(st === 'completed' || st === 'cancelled') && (
              <SheetBtn icon="arrow.uturn.backward" label="Mark not done" onPress={() => act(resetTask)} />
            )}
            {st !== 'completed' && st !== 'cancelled' && (
              <SheetBtn icon="xmark" label="Cancel task" onPress={() => act(cancelTask)} />
            )}
            <SheetBtn
              icon="trash"
              label="Delete"
              onPress={() => {
                Alert.alert('Delete task?', `“${task.title}” will be removed.`, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => {
                      onDelete();
                      onClose();
                    },
                  },
                ]);
              }}
              red
            />
          </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function SheetBtn({
  icon,
  label,
  onPress,
  primary,
  green,
  red,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  primary?: boolean;
  green?: boolean;
  red?: boolean;
}) {
  const tint = primary ? C.bg : green ? C.green : red ? C.red : C.ink;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.sheetBtn,
        primary && { backgroundColor: C.brass, borderColor: C.brass },
        pressed && { opacity: 0.8 },
      ]}>
      <SymbolView name={icon as any} size={17} tintColor={tint} fallback={<Text>•</Text>} />
      <Text
        style={[
          styles.sheetBtnText,
          primary && { color: C.bg },
          green && { color: C.green },
          red && { color: C.red },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---------- Add / edit task modal ----------
const REPEAT_OPTS: [RepeatType | 'none', string][] = [
  ['none', "Doesn't"],
  ['daily', 'Daily'],
  ['weekdays', 'Weekdays'],
  ['weekends', 'Weekends'],
  ['weekly', 'Weekly'],
  ['monthly', 'Monthly'],
  ['yearly', 'Yearly'],
];
function TaskModal({
  visible,
  editing,
  defaultTime,
  dayTasks,
  onClose,
  onSave,
}: {
  visible: boolean;
  editing?: Task | null;
  defaultTime?: string;
  dayTasks?: Task[];
  onClose: () => void;
  onSave: (p: {
    title: string;
    time: string;
    duration: number;
    categories: string[];
    priority: Priority;
    note: string;
    repeat: RepeatType | 'none';
    repeatDays: number[];
    repeatStart: string;
  }) => void;
}) {
  const [title, setTitle] = useState('');
  const [time, setTime] = useState(() => new Date());
  const [duration, setDuration] = useState(30);
  const [priority, setPriority] = useState<Priority>('medium');
  const [cats, setCats] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [custom, setCustom] = useState('');
  const [repeat, setRepeat] = useState<RepeatType | 'none'>('none');
  const [repeatDays, setRepeatDays] = useState<number[]>([]);
  const [repeatStart, setRepeatStart] = useState(() => new Date());
  const [showRepeatStart, setShowRepeatStart] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (editing) {
      setTitle(editing.title);
      const [h, m] = (editing.time || '9:00').split(':').map(Number);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      setTime(d);
      setDuration(editing.duration ?? 30);
      setPriority((editing.priority as Priority) ?? 'medium');
      setCats(getCategories(editing));
      setNote(editing.note ?? '');
      setCustom('');
      setRepeat((editing.repeat as RepeatType) ?? 'none');
      setRepeatDays(Array.isArray(editing.repeatDays) ? editing.repeatDays : []);
      setRepeatStart(new Date());
      setShowRepeatStart(false);
    } else {
      setTitle('');
      const d = new Date();
      if (defaultTime) {
        const [h, m] = defaultTime.split(':').map(Number);
        d.setHours(h, m, 0, 0);
      } else {
        d.setMinutes(0, 0, 0);
        d.setHours(d.getHours() + 1);
      }
      setTime(d);
      setDuration(30);
      setPriority('medium');
      setCats([]);
      setNote('');
      setCustom('');
      setRepeat('none');
      setRepeatDays([]);
      setRepeatStart(new Date());
      setShowRepeatStart(false);
    }
  }, [visible, editing, defaultTime]);

  const save = () => {
    if (!title.trim()) return;
    onSave({
      title,
      time: `${pad(time.getHours())}:${pad(time.getMinutes())}`,
      duration,
      categories: cats,
      priority,
      note,
      repeat,
      repeatDays,
      repeatStart: dateKey(repeatStart),
    });
    onClose();
  };

  const conflicts = useMemo(() => {
    if (!dayTasks || !dayTasks.length) return [];
    const hhmm = `${pad(time.getHours())}:${pad(time.getMinutes())}`;
    const excl = new Set<string>(editing?.id ? [editing.id] : []);
    return conflictsOnDay(hhmm, duration, dayTasks, excl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayTasks, time, duration, editing?.id]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { maxHeight: '90%' }]}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{editing ? 'Edit task' : 'New task'}</Text>

            <Text style={styles.fieldLabel}>TITLE</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="What needs doing?"
              placeholderTextColor={C.inkFaint}
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>TIME</Text>
            <View style={styles.pickerWrap}>
              <DateTimePicker
                value={time}
                mode="time"
                display="spinner"
                themeVariant="dark"
                onChange={(_, d) => d && setTime(d)}
                style={styles.picker}
              />
            </View>

            <Text style={styles.fieldLabel}>DURATION</Text>
            <View style={styles.chipRow}>
              {DURATIONS.map((d) => (
                <Pressable
                  key={d}
                  onPress={() => setDuration(d)}
                  style={[styles.chip, duration === d && styles.chipActive]}>
                  <Text style={[styles.chipText, duration === d && styles.chipTextActive]}>
                    {fmtDuration(d)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>PRIORITY</Text>
            <View style={styles.chipRow}>
              {PRIORITIES.map((p) => (
                <Pressable
                  key={p}
                  onPress={() => setPriority(p)}
                  style={[
                    styles.chip,
                    priority === p && { backgroundColor: prioColor(p) + '22', borderColor: prioColor(p) },
                  ]}>
                  <Text
                    style={[
                      styles.chipText,
                      priority === p && { color: prioColor(p), fontFamily: F.semibold },
                    ]}>
                    {prioMeta(p)?.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>CATEGORIES</Text>
            <View style={styles.chipRow}>
              {[...ALL_CATS, ...cats.filter((c) => !ALL_CATS.includes(c))].map((c) => {
                const on = cats.includes(c);
                return (
                  <Pressable
                    key={c}
                    onPress={() => setCats((s) => (on ? s.filter((x) => x !== c) : [...s, c]))}
                    style={[styles.chip, on && { backgroundColor: catColor(c) + '22', borderColor: catColor(c) }]}>
                    <View style={[styles.catDot, { backgroundColor: catColor(c) }]} />
                    <Text style={[styles.chipText, on && { color: C.ink }]}>{c}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.addCatRow}>
              <TextInput
                value={custom}
                onChangeText={setCustom}
                placeholder="Add a category…"
                placeholderTextColor={C.inkFaint}
                style={styles.addCatInput}
                autoCapitalize="none"
                onSubmitEditing={() => {
                  const c = custom.trim().toLowerCase();
                  if (c && !cats.includes(c)) setCats((s) => [...s, c]);
                  setCustom('');
                }}
              />
              <Pressable
                style={styles.addCatBtn}
                onPress={() => {
                  const c = custom.trim().toLowerCase();
                  if (c && !cats.includes(c)) setCats((s) => [...s, c]);
                  setCustom('');
                }}>
                <Text style={styles.addCatBtnText}>Add</Text>
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>NOTE</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Optional details…"
              placeholderTextColor={C.inkFaint}
              style={[styles.input, styles.noteInput]}
              multiline
            />

            {!editing && (
              <>
                <Text style={styles.fieldLabel}>REPEAT</Text>
                <View style={styles.chipRow}>
                  {REPEAT_OPTS.map(([k, l]) => {
                    const on = repeat === k;
                    return (
                      <Pressable
                        key={k}
                        onPress={() => setRepeat(k)}
                        style={[styles.chip, on && styles.chipActive]}>
                        <Text style={[styles.chipText, on && styles.chipTextActive]}>{l}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {repeat === 'weekly' && (
                  <View style={styles.weekRow}>
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => {
                      const on = repeatDays.includes(i);
                      return (
                        <Pressable
                          key={i}
                          onPress={() =>
                            setRepeatDays((s) => (on ? s.filter((x) => x !== i) : [...s, i]))
                          }
                          style={[styles.weekBtn, on && styles.weekBtnOn]}>
                          <Text style={[styles.weekText, on && styles.weekTextOn]}>{d}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {repeat !== 'none' && (
                  <>
                    <Pressable
                      style={styles.repeatStartRow}
                      onPress={() => setShowRepeatStart((s) => !s)}>
                      <Text style={styles.repeatStartLabel}>STARTS ON</Text>
                      <Text style={styles.repeatStartVal}>
                        {repeatStart.toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </Text>
                    </Pressable>
                    {showRepeatStart && (
                      <View style={[styles.pickerWrap, { marginTop: 10 }]}>
                        <DateTimePicker
                          value={repeatStart}
                          mode="date"
                          display="spinner"
                          themeVariant="dark"
                          onChange={(_, nd) => nd && setRepeatStart(nd)}
                          style={styles.picker}
                        />
                      </View>
                    )}
                  </>
                )}
              </>
            )}
            {editing && (
              <>
                <Text style={styles.fieldLabel}>REPEAT</Text>
                <View style={styles.chipRow}>
                  {REPEAT_OPTS.map(([k, l]) => {
                    const on = repeat === k;
                    return (
                      <Pressable
                        key={k}
                        onPress={() => setRepeat(k)}
                        style={[styles.chip, on && styles.chipActive]}>
                        <Text style={[styles.chipText, on && styles.chipTextActive]}>{l}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {repeat === 'weekly' && (
                  <View style={styles.weekRow}>
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => {
                      const on = repeatDays.includes(i);
                      return (
                        <Pressable
                          key={i}
                          onPress={() =>
                            setRepeatDays((s) => (on ? s.filter((x) => x !== i) : [...s, i]))
                          }
                          style={[styles.weekBtn, on && styles.weekBtnOn]}>
                          <Text style={[styles.weekText, on && styles.weekTextOn]}>{d}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {repeat !== 'none' && (
                  <Text style={styles.repeatHint}>
                    Editing applies to the whole series from its start date.
                  </Text>
                )}
              </>
            )}

            {conflicts.length > 0 && (
              <View style={styles.conflictBox}>
                <View style={styles.conflictHead}>
                  <SymbolView
                    name="exclamationmark.triangle.fill"
                    size={15}
                    tintColor="#D9A85C"
                    fallback={<Text style={{ color: '#D9A85C' }}>!</Text>}
                  />
                  <Text style={styles.conflictTitle}>
                    Overlaps {conflicts.length} task{conflicts.length > 1 ? 's' : ''}
                  </Text>
                </View>
                {conflicts.slice(0, 4).map((o) => (
                  <Text key={o.id} style={styles.conflictRow}>
                    <Text style={{ color: C.ink, fontFamily: F.semibold }}>{fmtTime(o.time)}</Text>
                    {'  '}
                    {o.title}
                    {o.duration ? ` · ${fmtDuration(o.duration)}` : ''}
                  </Text>
                ))}
                <Text style={styles.conflictHint}>
                  This time runs into another task — adjust the time or save anyway.
                </Text>
              </View>
            )}

            <Pressable
              onPress={save}
              style={({ pressed }) => [
                styles.saveBtn,
                pressed && { opacity: 0.85 },
                !title.trim() && { opacity: 0.5 },
              ]}>
              <Text style={styles.saveBtnText}>{editing ? 'Save changes' : 'Add task'}</Text>
            </Pressable>
            <Pressable onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------- Move modal (multi-select) ----------
function TaskHistoryModal({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const cc = task ? changeCounts(task) : { moved: 0, rescheduled: 0, swapped: 0 };
  const summary = changeSummary(cc) || 'changed';
  const fmtKey = (k?: string) =>
    k ? new Date(k + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  const fmtWhen = (ts: number) => {
    const d = new Date(ts);
    return (
      d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' · ' +
      d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    );
  };
  const changes = (task?.changes || []) as TaskChange[];
  const META: Record<string, { ic: string; label: string; color: string }> = {
    moved: { ic: 'arrow.right', label: 'Moved', color: C.blue },
    rescheduled: { ic: 'clock', label: 'Rescheduled', color: C.amber },
    swapped: { ic: 'arrow.left.arrow.right', label: 'Swapped', color: C.blue },
  };
  return (
    <Modal visible={!!task} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { maxHeight: '82%' }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Change history</Text>
          <Text style={styles.sheetSub} numberOfLines={2}>
            {task ? `“${task.title}” — ${summary}` : ''}
          </Text>
          <ScrollView showsVerticalScrollIndicator={false} style={{ marginTop: 8 }}>
            <View style={styles.histRow}>
              <View style={[styles.histIc, { backgroundColor: C.brass + '22' }]}>
                <SymbolView name="flag.fill" size={12} tintColor={C.brass} fallback={<Text style={{ color: C.brass }}>⚑</Text>} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.histAct}>Originally planned</Text>
                <Text style={styles.histMeta}>
                  {task?.origKey ? fmtKey(task.origKey) + ' · ' : ''}
                  {fmtTime(task?.origTime || task?.time || '0:0')}
                </Text>
              </View>
            </View>
            {changes.map((c, i) => {
              const m = META[c.type] || { ic: 'arrow.right', label: 'Changed', color: C.inkDim };
              const fromLbl = (c.fromKey ? fmtKey(c.fromKey) + ' ' : '') + fmtTime(c.from);
              const toLbl = (c.toKey ? fmtKey(c.toKey) + ' ' : '') + fmtTime(c.to);
              return (
                <View key={i} style={styles.histRow}>
                  <View style={[styles.histIc, { backgroundColor: m.color + '22' }]}>
                    <SymbolView name={m.ic as any} size={12} tintColor={m.color} fallback={<Text style={{ color: m.color }}>•</Text>} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.histAct}>
                      <Text style={{ color: m.color, fontFamily: F.semibold }}>{m.label}</Text>{'  '}
                      {fromLbl} <Text style={{ color: C.inkFaint }}>→</Text>{' '}
                      <Text style={{ fontFamily: F.semibold, color: C.ink }}>{toLbl}</Text>
                    </Text>
                    <Text style={styles.histMeta}>{fmtWhen(c.at)}</Text>
                  </View>
                </View>
              );
            })}
            <View style={{ height: 8 }} />
          </ScrollView>
          <Pressable style={styles.histDoneBtn} onPress={onClose}>
            <Text style={styles.histDoneText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function MoveModal({
  visible,
  moving,
  bundle,
  currentDk,
  onClose,
  onMove,
}: {
  visible: boolean;
  moving: Task[];
  bundle: Bundle | null;
  currentDk: string;
  onClose: () => void;
  onMove: (targetDk: string, newTime: string | null) => void;
}) {
  const [target, setTarget] = useState(() => new Date());
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    if (!visible) return;
    setTarget(new Date(currentDk + 'T00:00:00'));
    const d = new Date();
    d.setMinutes(0, 0, 0);
    setTime(d);
  }, [visible, currentDk]);

  const targetDk = dateKey(target);
  const sameDate = targetDk === currentDk;
  const newTime = sameDate ? `${pad(time.getHours())}:${pad(time.getMinutes())}` : null;

  // conflict detection on the target day
  const movingIds = useMemo(() => new Set(moving.map((t) => t.id)), [moving]);
  const conflicts = useMemo(() => {
    const dayTasks = tasksForDay(bundle, targetDk);
    const out: { task: Task; against: Task[] }[] = [];
    for (const t of moving) {
      const tTime = sameDate && newTime ? newTime : t.time;
      const against = conflictsOnDay(tTime, t.duration, dayTasks, movingIds);
      if (against.length) out.push({ task: t, against });
    }
    return out;
  }, [bundle, targetDk, moving, sameDate, newTime, movingIds]);

  const move = () => {
    onMove(targetDk, newTime);
    onClose();
  };

  const stepDay = (delta: number) => {
    setTarget((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() + delta);
      return n;
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { maxHeight: '88%' }]}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              Move {moving.length} task{moving.length > 1 ? 's' : ''}
            </Text>
            <Text style={styles.sheetSub}>
              {sameDate
                ? 'Same day — pick a new time.'
                : 'Different day — each task keeps its existing time.'}
            </Text>

            <Text style={styles.fieldLabel}>TARGET DAY</Text>
            <View style={styles.dateStepper}>
              <Pressable style={styles.stepBtn} onPress={() => stepDay(-1)} hitSlop={8}>
                <SymbolView name="chevron.left" size={16} tintColor={C.ink} fallback={<Text>‹</Text>} />
              </Pressable>
              <Text style={styles.stepLabel}>{fmtDateLabel(target)}</Text>
              <Pressable style={styles.stepBtn} onPress={() => stepDay(1)} hitSlop={8}>
                <SymbolView name="chevron.right" size={16} tintColor={C.ink} fallback={<Text>›</Text>} />
              </Pressable>
            </View>

            {sameDate && (
              <>
                <Text style={styles.fieldLabel}>NEW TIME</Text>
                <View style={styles.pickerWrap}>
                  <DateTimePicker
                    value={time}
                    mode="time"
                    display="spinner"
                    themeVariant="dark"
                    onChange={(_, d) => d && setTime(d)}
                    style={styles.picker}
                  />
                </View>
              </>
            )}

            {conflicts.length > 0 && (
              <View style={styles.conflictBox}>
                <View style={styles.conflictHead}>
                  <SymbolView
                    name="exclamationmark.triangle.fill"
                    size={15}
                    tintColor="#D9A85C"
                    fallback={<Text style={{ color: '#D9A85C' }}>!</Text>}
                  />
                  <Text style={styles.conflictTitle}>
                    {conflicts.length} time conflict{conflicts.length > 1 ? 's' : ''}
                  </Text>
                </View>
                {conflicts.map(({ task, against }) => (
                  <Text key={task.id} style={styles.conflictRow}>
                    <Text style={{ color: C.ink, fontFamily: F.semibold }}>{task.title}</Text>
                    {'  overlaps  '}
                    <Text style={{ color: '#D9A85C' }}>
                      {against.map((a) => a.title).join(', ')}
                    </Text>
                  </Text>
                ))}
                <Text style={styles.conflictHint}>
                  You can still move them and adjust times after.
                </Text>
              </View>
            )}

            <Pressable
              onPress={move}
              style={({ pressed }) => [
                styles.saveBtn,
                conflicts.length > 0 && { backgroundColor: '#D9A85C' },
                pressed && { opacity: 0.85 },
              ]}>
              <Text style={styles.saveBtnText}>
                {conflicts.length > 0
                  ? 'Move anyway'
                  : `Move ${moving.length} task${moving.length > 1 ? 's' : ''}`}
              </Text>
            </Pressable>
            <Pressable onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ---------- Day stats strip ----------
function DayStatsStrip({ tasks }: { tasks: Task[] }) {
  const s = dayStats(tasks);
  if (!s.count) return null;
  return (
    <View style={styles.dayStats}>
      <View style={styles.statItem}>
        <SymbolView name="checklist" size={12} tintColor={C.brass} fallback={<Text style={{ color: C.brass }}>•</Text>} />
        <Text style={styles.statVal}>{s.count}</Text>
        <Text style={styles.statLabel}>{s.count === 1 ? 'task' : 'tasks'}</Text>
      </View>
      <View style={styles.statItem}>
        <SymbolView name="clock" size={12} tintColor={C.brass} fallback={<Text style={{ color: C.brass }}>•</Text>} />
        <Text style={styles.statVal}>{fmtDuration(s.plannedMin) || '0m'}</Text>
        <Text style={styles.statLabel}>planned</Text>
      </View>
      {s.freeMin > 0 && (
        <View style={styles.statItem}>
          <SymbolView name="hourglass" size={12} tintColor={C.brass} fallback={<Text style={{ color: C.brass }}>•</Text>} />
          <Text style={styles.statVal}>{fmtDuration(s.freeMin)}</Text>
          <Text style={styles.statLabel}>free</Text>
        </View>
      )}
      {s.endMin != null && (
        <View style={styles.statItem}>
          <SymbolView name="flag.checkered" size={12} tintColor={C.brass} fallback={<Text style={{ color: C.brass }}>•</Text>} />
          <Text style={styles.statLabel}>ends</Text>
          <Text style={styles.statVal}>{fmtTime(minToTime(s.endMin))}</Text>
        </View>
      )}
    </View>
  );
}

// ---------- Free slots modal ----------
function FreeSlotsModal({
  visible,
  tasks,
  onClose,
  onPick,
}: {
  visible: boolean;
  tasks: Task[];
  onClose: () => void;
  onPick: (time: string) => void;
}) {
  const gaps = useMemo(() => freeGaps(tasks), [tasks]);
  const STEP = 30; // slot spacing
  const MIN = 15; // smallest usable slot
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { maxHeight: '80%' }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Free time slots</Text>
          <Text style={styles.sheetSub}>Tap a start time to drop a task there.</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {gaps.length === 0 ? (
              <Text style={styles.emptyText}>No free gaps — your day is fully booked.</Text>
            ) : (
              gaps.map(([a, b], i) => {
                const slots: number[] = [];
                for (let m = a; m + MIN <= b; m += STEP) slots.push(m);
                if (!slots.length) slots.push(a);
                return (
                  <View key={i} style={styles.slotGroup}>
                    <View style={styles.slotGroupHead}>
                      <Text style={styles.slotTime}>
                        {fmtTime(minToTime(a))} – {fmtTime(minToTime(b))}
                      </Text>
                      <Text style={styles.slotDur}>{fmtDuration(b - a)} free</Text>
                    </View>
                    <View style={styles.slotChips}>
                      {slots.map((m) => (
                        <Pressable
                          key={m}
                          style={styles.slotChip}
                          onPress={() => {
                            onPick(minToTime(m));
                            onClose();
                          }}>
                          <Text style={styles.slotChipText}>{fmtTime(minToTime(m))}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                );
              })
            )}
            <View style={{ height: 10 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ---------- Swap modal ----------
function SwapModal({
  visible,
  tasks,
  onClose,
  onSwap,
}: {
  visible: boolean;
  tasks: Task[];
  onClose: () => void;
  onSwap: (a: string, b: string) => void;
}) {
  const [first, setFirst] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) setFirst(null);
  }, [visible]);
  const swappable = useMemo(
    () =>
      tasks.filter((t) => {
        const s = taskState(t);
        return !isActive(t) && s !== 'cancelled' && s !== 'carried' && s !== 'completed';
      }),
    [tasks],
  );
  const pick = (id: string) => {
    if (!first) setFirst(id);
    else if (first === id) setFirst(null);
    else {
      onSwap(first, id);
      onClose();
    }
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { maxHeight: '80%' }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Swap two tasks</Text>
          <Text style={styles.sheetSub}>
            {swappable.length < 2
              ? 'Need at least two open tasks to swap times.'
              : first
                ? 'Now pick the second task to swap times.'
                : 'Pick the first task.'}
          </Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {swappable.map((t) => (
              <Pressable
                key={t.id}
                style={[styles.swapRow, first === t.id && styles.swapRowOn]}
                onPress={() => pick(t.id)}>
                <Text style={styles.swapTime}>{fmtTime(t.time)}</Text>
                <Text style={styles.swapTitle} numberOfLines={1}>
                  {t.title}
                </Text>
                {first === t.id && (
                  <SymbolView name="1.circle.fill" size={18} tintColor={C.brass} fallback={<Text style={{ color: C.brass }}>①</Text>} />
                )}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function FabItem({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.fabItem} onPress={onPress}>
      <Text style={styles.fabItemLabel}>{label}</Text>
      <View style={styles.fabItemIcon}>
        <SymbolView name={icon as any} size={16} tintColor={C.brass} fallback={<Text style={{ color: C.brass }}>•</Text>} />
      </View>
    </Pressable>
  );
}

function CalendarModal({
  visible,
  date,
  onClose,
  onPick,
}: {
  visible: boolean;
  date: Date;
  onClose: () => void;
  onPick: (d: Date) => void;
}) {
  const [d, setD] = useState(date);
  useEffect(() => {
    if (visible) setD(date);
  }, [visible, date]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Jump to date</Text>
          <View style={[styles.pickerWrap, { marginTop: 14 }]}>
            <DateTimePicker
              value={d}
              mode="date"
              display="spinner"
              themeVariant="dark"
              onChange={(_, nd) => nd && setD(nd)}
              style={styles.picker}
            />
          </View>
          <Pressable
            style={styles.saveBtn}
            onPress={() => {
              onPick(d);
              onClose();
            }}>
            <Text style={styles.saveBtnText}>Go to this day</Text>
          </Pressable>
          <Pressable style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function SettingsModal({
  visible,
  code,
  onClose,
  onSave,
  onRefresh,
  refreshing,
}: {
  visible: boolean;
  code: string;
  onClose: () => void;
  onSave: (code: string) => void;
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  const [val, setVal] = useState(code);
  useEffect(() => {
    if (visible) setVal(code);
  }, [visible, code]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Sync</Text>
          <Text style={styles.sheetSub}>
            Code <Text style={{ color: C.brass, fontFamily: F.semibold }}>{code}</Text>. Pull the
            latest from your other devices, or switch to a different code.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.saveBtn, { marginTop: 6 }, pressed && { opacity: 0.85 }]}
            onPress={() => {
              onRefresh();
              onClose();
            }}>
            <Text style={styles.saveBtnText}>{refreshing ? 'Refreshing…' : 'Refresh now'}</Text>
          </Pressable>
          <Text style={styles.fieldLabel}>CHANGE SYNC CODE</Text>
          <TextInput
            value={val}
            onChangeText={setVal}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="your-sync-code"
            placeholderTextColor={C.inkFaint}
            style={styles.input}
          />
          <Pressable
            style={({ pressed }) => [
              styles.outlineBtn,
              pressed && { opacity: 0.85 },
              (val.trim().length < 4 || val.trim() === code) && { opacity: 0.4 },
            ]}
            disabled={val.trim().length < 4 || val.trim() === code}
            onPress={() => {
              if (val.trim().length >= 4 && val.trim() !== code) {
                onSave(val.trim());
                onClose();
              }
            }}>
            <Text style={styles.outlineBtnText}>Switch code & sync</Text>
          </Pressable>
          <Pressable style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>Close</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SortSheet({
  visible,
  mode,
  onClose,
  onPick,
}: {
  visible: boolean;
  mode: 'time' | 'priority' | 'category' | 'source';
  onClose: () => void;
  onPick: (m: 'time' | 'priority' | 'category' | 'source') => void;
}) {
  const opts: { key: 'time' | 'priority' | 'category' | 'source'; label: string; sub: string }[] = [
    { key: 'time', label: 'By time', sub: 'Chronological order' },
    { key: 'priority', label: 'By priority', sub: 'Must → low' },
    { key: 'category', label: 'By category', sub: 'Grouped by tag' },
    { key: 'source', label: 'Self vs booked', sub: 'Your tasks first' },
  ];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Sort tasks</Text>
          {opts.map((o) => {
            const on = mode === o.key;
            return (
              <Pressable
                key={o.key}
                style={styles.sortRow}
                onPress={() => {
                  onPick(o.key);
                  onClose();
                }}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sortRowLabel, on && { color: C.brass }]}>{o.label}</Text>
                  <Text style={styles.sortRowSub}>{o.sub}</Text>
                </View>
                {on && (
                  <SymbolView
                    name="checkmark"
                    size={16}
                    tintColor={C.brass}
                    fallback={<Text style={{ color: C.brass }}>✓</Text>}
                  />
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

function CloseDayModal({
  tasks,
  onClose,
  onCarryClose,
  onCloseAnyway,
}: {
  tasks: Task[];
  onClose: () => void;
  onCarryClose: (unfinished: Task[]) => void;
  onCloseAnyway: () => void;
}) {
  const statusInfo = (t: Task): { label: string; color: string } => {
    const s = taskState(t);
    if (s === 'completed') return { label: 'Done', color: C.green };
    if (s === 'running') return isPaused(t) ? { label: 'Paused', color: C.amber } : { label: 'Running', color: C.brass };
    if (s === 'cancelled') return { label: 'Cancelled', color: C.red };
    if (s === 'carried') return { label: 'Carried', color: C.blue };
    return { label: 'Pending', color: C.inkDim };
  };
  const ordered = [...tasks].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  const doneN = tasks.filter((t) => taskState(t) === 'completed').length;
  const unfinished = tasks.filter((t) => {
    const s = taskState(t);
    return s === 'pending' || s === 'running';
  });
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { maxHeight: '82%' }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Close out this day?</Text>
          <Text style={styles.sheetSub}>
            {doneN}/{tasks.length} done
            {unfinished.length ? ` · ${unfinished.length} still open` : ' · all wrapped up'}
          </Text>
          <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            {ordered.map((t) => {
              const info = statusInfo(t);
              const sdone = taskState(t) === 'completed';
              return (
                <View key={t.id} style={styles.cdRow}>
                  <Text style={styles.cdTime}>{fmtTime(t.time)}</Text>
                  <Text
                    style={[styles.cdTitle, sdone && styles.strike, sdone && { color: C.inkDim }]}
                    numberOfLines={1}>
                    {t.title}
                  </Text>
                  <View style={[styles.cdBadge, { backgroundColor: info.color + '22' }]}>
                    <Text style={[styles.cdBadgeText, { color: info.color }]}>{info.label}</Text>
                  </View>
                </View>
              );
            })}
            {ordered.length === 0 && <Text style={styles.cdEmpty}>No tasks on this day.</Text>}
          </ScrollView>
          {unfinished.length > 0 ? (
            <>
              <Pressable
                style={styles.saveBtn}
                onPress={() => {
                  onCarryClose(unfinished);
                  onClose();
                }}>
                <Text style={styles.saveBtnText}>
                  Carry {unfinished.length} to tomorrow & close
                </Text>
              </Pressable>
              <Pressable
                style={styles.outlineBtn}
                onPress={() => {
                  onCloseAnyway();
                  onClose();
                }}>
                <Text style={styles.outlineBtnText}>Close anyway (leave them)</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              style={styles.saveBtn}
              onPress={() => {
                onCloseAnyway();
                onClose();
              }}>
              <Text style={styles.saveBtnText}>Close the day</Text>
            </Pressable>
          )}
          <Pressable style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export default function PlannerScreen() {
  const planner = usePlanner();
  const insets = useSafeAreaInsets();
  const navBottom = insets.bottom + 14; // floating pill + FAB sit on this line
  const pillH = 50;
  const fabBottom = navBottom; // FAB shares the pill's baseline (pill left, FAB right)
  const [view, setView] = useState<ViewKey>('planner');
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [sheetTask, setSheetTask] = useState<Task | null>(null);
  const [historyTask, setHistoryTask] = useState<Task | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<'time' | 'priority' | 'category' | 'source'>('time');
  const [sortOpen, setSortOpen] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [closeDayOpen, setCloseDayOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTargets, setMoveTargets] = useState<Task[]>([]);
  const [calOpen, setCalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [addTime, setAddTime] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const date = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d;
  }, [offset]);
  const isToday = sameDay(date, new Date());
  const dk = dateKey(date);
  const dayStartMs = useMemo(() => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, [date]);

  const tasks = useMemo(() => tasksForDay(planner.bundle, dk), [planner.bundle, dk]);
  const sortedTasks = useMemo(() => {
    if (sortMode === 'time') return tasks;
    const arr = [...tasks];
    const pr = (p?: string) =>
      (({ must: 4, high: 3, medium: 2, low: 1 } as Record<string, number>)[p || 'medium']) || 2;
    const byTime = (a: Task, b: Task) => timeToMinutes(a.time) - timeToMinutes(b.time);
    if (sortMode === 'priority') arr.sort((a, b) => pr(b.priority) - pr(a.priority) || byTime(a, b));
    else if (sortMode === 'category')
      arr.sort(
        (a, b) =>
          (getCategories(a)[0] || '~').localeCompare(getCategories(b)[0] || '~') || byTime(a, b),
      );
    else if (sortMode === 'source')
      arr.sort((a, b) => (a.booking ? 1 : 0) - (b.booking ? 1 : 0) || byTime(a, b));
    return arr;
  }, [tasks, sortMode]);
  const focus = useMemo(() => pickFocus(tasks, isToday), [tasks, isToday, Math.floor(now / 60000)]);

  // Drive the native Live Activity: show when a task is in progress, or within 5
  // minutes of starting (incl. running late). No-op in Expo Go.
  const laTaskRef = useRef<string | null>(null);
  useEffect(() => {
    if (!LiveActivity.isSupported()) return;
    const shouldShow = (() => {
      if (!isToday || !focus) return false;
      if (isActive(focus)) return true;
      const [h, m] = focus.time.split(':').map(Number);
      const start = new Date(date);
      start.setHours(h, m, 0, 0);
      const minsUntil = (start.getTime() - now) / 60000;
      // within 5 min before, or already due (running late)
      return minsUntil <= 5;
    })();
    if (!shouldShow || !focus) {
      if (laTaskRef.current) {
        LiveActivity.endAll();
        laTaskRef.current = null;
      }
      return;
    }
    const payload = taskToLiveActivity(focus, date);
    const running = LiveActivity.running();
    if (laTaskRef.current === focus.id && running.length) {
      LiveActivity.update(running[0], payload);
    } else {
      LiveActivity.endAll().then(() => LiveActivity.start(payload));
      laTaskRef.current = focus.id;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.id, isToday, focus ? taskState(focus) : '', Math.floor(now / 60000)]);
  const selected = useMemo(
    () => tasks.filter((t) => selectedIds.has(t.id)),
    [tasks, selectedIds],
  );

  const requirePauseFirst = (list: Task[], verb: string): boolean => {
    const active = list.find((t) => isActive(t));
    if (active) {
      Alert.alert(
        'Pause it first',
        `“${active.title}” is in progress. Pause the timer before you ${verb} it.`,
        [{ text: 'OK' }],
      );
      return true;
    }
    return false;
  };

  const applyAction = (taskId: string, fn: (t: Task) => void) => {
    let toastMsg: string | null = null;
    let toastKind: 'success' | 'error' | 'info' = 'success';
    planner.mutate((b) => {
      let t = b.days[dk]?.tasks.find((x) => x.id === taskId);
      if (!t && taskId.includes('@')) {
        if (!b.days[dk]) b.days[dk] = { tasks: [] };
        t = materializeRecur(b, dk, taskId.split('@')[0]) ?? undefined;
      }
      if (t) {
        fn(t);
        const type =
          fn === startTask
            ? 'started'
            : fn === pauseRunning
              ? 'paused'
              : fn === resumeTask
                ? 'resumed'
                : fn === completeTask
                  ? 'completed'
                  : fn === cancelTask
                    ? 'cancelled'
                    : fn === resetTask
                      ? 'reopened'
                      : 'updated';
        logActivity(b, type, t, dk);
        if (type === 'completed') { toastMsg = 'Completed · ' + t.title; toastKind = 'success'; }
        else if (type === 'started') { toastMsg = 'Started · ' + t.title; toastKind = 'info'; }
        else if (type === 'cancelled') { toastMsg = 'Cancelled · ' + t.title; toastKind = 'error'; }
      }
    });
    if (toastMsg) LiveActivity.toast(toastMsg, toastKind);
  };
  const deleteTask = (task: Task) => {
    // A booked task: cancel the booking on the server (notifies the guest, frees the slot,
    // withdraws the Google event) AND dismiss it so reconcile never re-adds it. Delete = gone everywhere.
    if (task.booked && task.bookingId) {
      const bid = task.bookingId;
      const tok = planner.bundle?.booking?.planner_book_token;
      const sec = planner.bundle?.booking?.planner_book_secret;
      if (tok && sec) manageBooking(tok, sec, 'cancel', bid).catch(() => {});
      planner.mutate((b) => {
        logActivity(b, 'deleted', task, dk);
        if (!b.booking) b.booking = {};
        let list: string[] = [];
        try {
          list = JSON.parse(b.booking.planner_book_dismissed || '[]');
        } catch {}
        if (!list.includes(bid)) list.push(bid);
        b.booking.planner_book_dismissed = JSON.stringify(list);
        for (const key of Object.keys(b.days)) {
          const day = b.days[key];
          if (day?.tasks) day.tasks = day.tasks.filter((x) => x.bookingId !== bid);
        }
      });
      return;
    }
    planner.mutate((b) => {
      logActivity(b, 'deleted', task, dk);
      if (task.recurId) {
        skipRecur(b, dk, task.recurId);
        const day = b.days[dk];
        if (day) day.tasks = day.tasks.filter((x) => x.recurId !== task.recurId);
        return;
      }
      const day = b.days[dk];
      if (day) day.tasks = day.tasks.filter((x) => x.id !== task.id);
    });
  };
  const saveTask = (p: {
    title: string;
    time: string;
    duration: number;
    categories: string[];
    priority: Priority;
    note: string;
    repeat: RepeatType | 'none';
    repeatDays: number[];
    repeatStart: string;
  }) => {
    if (editingTask) {
      const et = editingTask;
      planner.mutate((b) => {
        let t = b.days[dk]?.tasks.find((x) => x.id === et.id);
        if (!t && et.recurId) t = materializeRecur(b, dk, et.recurId) ?? undefined;
        if (!t && et.id.includes('@'))
          t = materializeRecur(b, dk, et.id.split('@')[0]) ?? undefined;
        if (!t) return;
        t.title = p.title.trim();
        t.time = p.time;
        t.duration = p.duration;
        t.categories = p.categories;
        t.priority = p.priority;
        t.note = p.note.trim() || undefined;
        handleRecurrence(b, t, p.repeat, p.repeatDays, p.repeatStart, dk);
        logActivity(b, 'edited', t, dk);
      });
    } else if (p.repeat && p.repeat !== 'none') {
      planner.mutate((b) => {
        if (!b.days[dk]) b.days[dk] = { tasks: [] };
        const t = newTask(p);
        b.days[dk].tasks.push(t);
        handleRecurrence(b, t, p.repeat, p.repeatDays, p.repeatStart, dk);
        logActivity(b, 'created', t, dk);
      });
    } else {
      planner.mutate((b) => {
        if (!b.days[dk]) b.days[dk] = { tasks: [] };
        const t = newTask(p);
        b.days[dk].tasks.push(t);
        logActivity(b, 'created', t, dk);
      });
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const exitSelect = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const doMove = (targetDk: string, newTime: string | null) => {
    planner.mutate((b) => {
      if (!b.days[dk]) b.days[dk] = { tasks: [] };
      const ids = new Set<string>();
      for (const mt of moveTargets) {
        let t = b.days[dk].tasks.find((x) => x.id === mt.id);
        if (!t && mt.recurId) {
          t = materializeRecur(b, dk, mt.recurId);
          skipRecur(b, dk, mt.recurId);
        }
        if (t) ids.add(t.id);
      }
      const movers = b.days[dk].tasks.filter((t) => ids.has(t.id));
      if (targetDk === dk) {
        if (newTime) movers.forEach((t) => { recordChange(t, 'rescheduled', t.time, newTime, dk, targetDk); t.time = newTime; });
      } else {
        b.days[dk].tasks = b.days[dk].tasks.filter((t) => !ids.has(t.id));
        if (!b.days[targetDk]) b.days[targetDk] = { tasks: [] };
        movers.forEach((t) => {
          recordChange(t, 'moved', t.time, newTime || t.time, dk, targetDk);
          delete t.recurId;
          t.createdAt = Date.now();
          b.days[targetDk].tasks.push(t);
        });
      }
      movers.forEach((t) => logActivity(b, 'moved', t, dk, targetDk === dk ? `to ${newTime}` : `to ${targetDk}`));
    });
    exitSelect();
  };

  const carryTask = (task: Task) => {
    const tomorrow = new Date(date);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tdk = dateKey(tomorrow);
    planner.mutate((b) => {
      if (!b.days[dk]) b.days[dk] = { tasks: [] };
      let t = b.days[dk].tasks.find((x) => x.id === task.id);
      if (!t && task.recurId) {
        t = materializeRecur(b, dk, task.recurId);
        skipRecur(b, dk, task.recurId);
      }
      if (!t) return;
      const tid = t.id;
      b.days[dk].tasks = b.days[dk].tasks.filter((x) => x.id !== tid);
      delete t.startedAt;
      delete t.completedAt;
      delete t.accumMs;
      delete t.runningSince;
      delete t.pausedAccumMs;
      delete t.pausedSince;
      t.done = false;
      delete t.recurId;
      t.createdAt = Date.now();
      if (!b.days[tdk]) b.days[tdk] = { tasks: [] };
      b.days[tdk].tasks.push(t);
      logActivity(b, 'carried', t, dk, 'to tomorrow');
    });
  };

  const closed = !!planner.bundle?.days[dk]?.closed;
  const openAdd = (time?: string) => {
    setEditingTask(null);
    setAddTime(time ?? null);
    setModalOpen(true);
  };
  const doToggleClose = () => {
    let closing = false;
    planner.mutate((b) => {
      if (!b.days[dk]) b.days[dk] = { tasks: [] };
      b.days[dk].closed = !b.days[dk].closed;
      closing = !!b.days[dk].closed;
    });
    if (closing) LiveActivity.toast('Day closed out', 'success');
  };
  const carryAllAndClose = (list: Task[]) => {
    const tomorrow = new Date(date);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tdk = dateKey(tomorrow);
    planner.mutate((b) => {
      if (!b.days[dk]) b.days[dk] = { tasks: [] };
      for (const task of list) {
        let t = b.days[dk].tasks.find((x) => x.id === task.id);
        if (!t && task.recurId) {
          t = materializeRecur(b, dk, task.recurId);
          skipRecur(b, dk, task.recurId);
        }
        if (!t) continue;
        const tid = t.id;
        b.days[dk].tasks = b.days[dk].tasks.filter((x) => x.id !== tid);
        delete t.startedAt;
        delete t.completedAt;
        delete t.accumMs;
        delete t.runningSince;
        delete t.pausedAccumMs;
        delete t.pausedSince;
        t.done = false;
        delete t.recurId;
        t.createdAt = Date.now();
        if (!b.days[tdk]) b.days[tdk] = { tasks: [] };
        b.days[tdk].tasks.push(t);
      }
      b.days[dk].closed = true;
    });
    LiveActivity.toast('Day closed out', 'success');
  };
  const toggleClose = () => {
    if (closed) {
      doToggleClose();
      return;
    }
    setCloseDayOpen(true);
  };
  const swapTasks = (a: string, bId: string) => {
    planner.mutate((b) => {
      if (!b.days[dk]) b.days[dk] = { tasks: [] };
      const resolve = (id: string): Task | undefined => {
        let t = b.days[dk].tasks.find((x) => x.id === id);
        if (!t && id.includes('@')) t = materializeRecur(b, dk, id.split('@')[0]) ?? undefined;
        return t;
      };
      const ta = resolve(a);
      const tb = resolve(bId);
      if (ta && tb && ta.id !== tb.id) {
        const tmp = ta.time;
        recordChange(ta, 'swapped', ta.time, tb.time, dk, dk);
        recordChange(tb, 'swapped', tb.time, tmp, dk, dk);
        ta.time = tb.time;
        tb.time = tmp;
        logActivity(b, 'swapped', ta, dk, `with ${tb.title}`);
      }
    });
  };

  const fixedTop = (
    <View style={styles.fixedTop}>
      <View style={styles.header}>
        <View style={styles.dateBlock}>
          <Text style={styles.dayNameText}>{dayName(date).toUpperCase()}</Text>
          <Text style={styles.dateFull}>
            {date.toLocaleDateString(undefined, { month: 'long' })}{' '}
            <Text style={{ color: C.brass }}>{date.getDate()}</Text>
            {', '}
            {String(date.getFullYear()).slice(0, 2)}
            <Text style={{ color: C.brass }}>{String(date.getFullYear()).slice(2)}</Text>
          </Text>
        </View>
        <View style={styles.navArrows}>
          <NavBtn
            onPress={() => setSettingsOpen(true)}
            icon="arrow.triangle.2.circlepath"
            dot={planner.error ? C.red : planner.refreshing ? C.brass : C.green}
          />
          <NavBtn onPress={() => setOffset((o) => o - 1)} icon="chevron.left" />
          <NavBtn onPress={() => setCalOpen(true)} icon="calendar" />
          <NavBtn onPress={() => setOffset((o) => o + 1)} icon="chevron.right" />
        </View>
      </View>

      <Hero focus={focus} isToday={isToday} date={date} now={now} />
    </View>
  );

  const scrollHeader = (
    <View>
      <DayProgress tasks={tasks} now={now} isToday={isToday} onPress={(t) => setSheetTask(t)} />
      <DayStatsStrip tasks={tasks} />

      {closed && (
        <View style={styles.closedBanner}>
          <SymbolView name="checkmark.seal.fill" size={14} tintColor={C.green} fallback={<Text style={{ color: C.green }}>✓</Text>} />
          <Text style={styles.closedBannerText}>Day closed out</Text>
        </View>
      )}

      {tasks.length > 0 && (
        <View style={styles.timelineHead}>
          <Text style={styles.sectionLabel}>TIMELINE</Text>
          <Pressable
            style={styles.sortBtn}
            onPress={() => (selectMode ? exitSelect() : setSortOpen(true))}
            hitSlop={8}>
            {!selectMode && (
              <SymbolView
                name="arrow.up.arrow.down"
                size={12}
                tintColor={C.brass}
                fallback={<Text style={{ color: C.brass }}>↕</Text>}
              />
            )}
            <Text style={styles.selectToggle}>{selectMode ? 'Done' : 'Sort'}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        {view === 'planner' ? (
          <>
            {fixedTop}
            <FlatList
            style={{ flex: 1 }}
            data={sortedTasks}
            keyExtractor={(t, i) => t.id + i}
            extraData={now}
            renderItem={({ item }) => (
              <TaskRowMemo
                task={item}
                selectMode={selectMode}
                selected={selectedIds.has(item.id)}
                now={now}
                isToday={isToday}
                compact={!!focus && focus.id === item.id}
                dayStartMs={dayStartMs}
                onPress={() => (selectMode ? toggleSelect(item.id) : setSheetTask(item))}
                onHistory={(t) => setHistoryTask(t)}
              />
            )}
            ListHeaderComponent={scrollHeader}
            contentContainerStyle={[styles.listContent, { paddingBottom: fabBottom + 70 }]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={pulling}
                onRefresh={async () => {
                  setPulling(true);
                  await planner.refresh();
                  setPulling(false);
                }}
                tintColor={C.brass}
              />
            }
            ListEmptyComponent={
              !planner.loading ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>No tasks yet. Tap + to add one.</Text>
                </View>
              ) : null
            }
          />
          </>
        ) : view === 'bookings' ? (
          <View style={styles.viewPad}>
            <BookingsView
              token={planner.bundle?.booking?.planner_book_token}
              secret={planner.bundle?.booking?.planner_book_secret}
              bundle={planner.bundle}
              onMutate={planner.mutate}
              bottomInset={navBottom + pillH + 18}
            />
          </View>
        ) : (
          <View style={styles.viewPad}>
            <AuditView bundle={planner.bundle} bottomInset={navBottom + pillH + 18} />
          </View>
        )}
      </SafeAreaView>

      <BottomBar value={view} onChange={setView} bottom={navBottom} />

      {/* bulk action bar */}
      {selectMode && (
        <View style={[styles.bulkBar, { bottom: navBottom + pillH + 12 }]}>
          <Text style={styles.bulkCount}>{selected.length} selected</Text>
          <View style={styles.bulkBtns}>
            <Pressable
              style={[styles.bulkBtn, selected.length === 0 && { opacity: 0.4 }]}
              disabled={selected.length === 0}
              onPress={() => {
                if (requirePauseFirst(selected, 'move')) return;
                setMoveTargets(selected);
                setMoveOpen(true);
              }}>
              <SymbolView name="calendar" size={15} tintColor={C.bg} fallback={<Text>→</Text>} />
              <Text style={styles.bulkBtnText}>Move</Text>
            </Pressable>
            <Pressable style={styles.bulkCancel} onPress={exitSelect}>
              <Text style={styles.bulkCancelText}>Done</Text>
            </Pressable>
          </View>
        </View>
      )}

      {!selectMode && (
        <>
          {view === 'planner' && fabOpen && (
            <BlurView
              intensity={32}
              tint="dark"
              style={StyleSheet.absoluteFill}
              pointerEvents="auto"
            />
          )}
          {view === 'planner' && fabOpen && (
            <Pressable style={styles.fabScrim} onPress={() => setFabOpen(false)} />
          )}
          {view === 'planner' && fabOpen && (
            <View style={[styles.fabMenu, { bottom: fabBottom + 56 + 12 }]}>
              <FabItem icon="plus" label="Add task" onPress={() => { setFabOpen(false); openAdd(); }} />
              <FabItem icon="clock" label="Free slots" onPress={() => { setFabOpen(false); setSlotsOpen(true); }} />
              <FabItem icon="arrow.left.arrow.right" label="Swap tasks" onPress={() => { setFabOpen(false); setSwapOpen(true); }} />
              <FabItem icon="checklist" label="Select & move" onPress={() => { setFabOpen(false); setSelectMode(true); }} />
              <FabItem icon={closed ? 'lock.open.fill' : 'checkmark.seal.fill'} label={closed ? 'Reopen day' : 'Close day'} onPress={() => { setFabOpen(false); toggleClose(); }} />
            </View>
          )}
          <Pressable
            style={({ pressed }) => [styles.fab, { bottom: fabBottom }, pressed && { transform: [{ scale: 0.93 }] }]}
            onPress={() => {
              if (view === 'planner') setFabOpen((o) => !o);
              else {
                setView('planner');
                openAdd();
              }
            }}>
            <LinearGradient
              colors={['#E0B36A', '#C9974A', '#B07F36']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <SymbolView
              name={view === 'planner' && fabOpen ? 'xmark' : 'plus'}
              size={24}
              tintColor={C.bg}
              fallback={<Text style={{ color: C.bg, fontSize: 22 }}>+</Text>}
            />
          </Pressable>
        </>
      )}

      <ActionSheet
        task={sheetTask}
        onClose={() => setSheetTask(null)}
        onAction={(fn) => sheetTask && applyAction(sheetTask.id, fn)}
        onDelete={() => sheetTask && deleteTask(sheetTask)}
        onEdit={() => {
          setEditingTask(sheetTask);
          setModalOpen(true);
        }}
        onMove={() => {
          if (sheetTask) {
            if (requirePauseFirst([sheetTask], 'move')) return;
            setMoveTargets([sheetTask]);
            setMoveOpen(true);
          }
        }}
        onCarry={() => sheetTask && carryTask(sheetTask)}
      />
      <TaskModal
        visible={modalOpen}
        editing={editingTask}
        defaultTime={addTime ?? undefined}
        dayTasks={tasks}
        onClose={() => {
          setModalOpen(false);
          setEditingTask(null);
          setAddTime(null);
        }}
        onSave={saveTask}
      />
      <MoveModal
        visible={moveOpen}
        moving={moveTargets}
        bundle={planner.bundle}
        currentDk={dk}
        onClose={() => setMoveOpen(false)}
        onMove={doMove}
      />
      <FreeSlotsModal
        visible={slotsOpen}
        tasks={tasks}
        onClose={() => setSlotsOpen(false)}
        onPick={(time) => openAdd(time)}
      />
      <SwapModal
        visible={swapOpen}
        tasks={tasks}
        onClose={() => setSwapOpen(false)}
        onSwap={swapTasks}
      />
      <TaskHistoryModal task={historyTask} onClose={() => setHistoryTask(null)} />
      <CalendarModal
        visible={calOpen}
        date={date}
        onClose={() => setCalOpen(false)}
        onPick={(picked) => {
          const today = new Date();
          const diff = Math.round(
            (new Date(dateKey(picked)).getTime() - new Date(dateKey(today)).getTime()) / 86400000,
          );
          setOffset(diff);
        }}
      />
      <SettingsModal
        visible={settingsOpen}
        code={planner.syncCode}
        refreshing={planner.refreshing}
        onClose={() => setSettingsOpen(false)}
        onSave={(c) => planner.setCode(c)}
        onRefresh={() => planner.refresh()}
      />
      <SortSheet
        visible={sortOpen}
        mode={sortMode}
        onClose={() => setSortOpen(false)}
        onPick={(m) => setSortMode(m)}
      />
      {closeDayOpen && (
        <CloseDayModal
          tasks={tasks}
          onClose={() => setCloseDayOpen(false)}
          onCarryClose={(unfinished) => carryAllAndClose(unfinished)}
          onCloseAnyway={doToggleClose}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  safe: { flex: 1 },
  listContent: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 120 },

  viewtabs: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    gap: 4,
    padding: 4,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 999,
    backgroundColor: C.card,
    marginBottom: 22,
  },
  viewtab: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999 },
  viewtabActive: { backgroundColor: C.brass },
  viewtabText: { fontFamily: F.semibold, color: C.inkDim, fontSize: 13 },
  viewtabTextActive: { color: C.bg },

  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  fixedTop: { paddingHorizontal: 22, paddingTop: 8 },
  dateBlock: { flex: 1 },
  dayNameText: { fontFamily: F.semibold, color: C.brass, fontSize: 12, letterSpacing: 2.2, marginBottom: 6 },
  dateFull: { fontFamily: F.medium, color: C.ink, fontSize: 28, lineHeight: 38, paddingBottom: 2 },
  navArrows: { flexDirection: 'row', gap: 8 },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navDot: { position: 'absolute', top: -1, right: -1, width: 9, height: 9, borderRadius: 5, borderWidth: 2, borderColor: C.bg },

  hero: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    overflow: 'hidden',
    minHeight: 190,
    justifyContent: 'flex-end',
    marginTop: 18,
    marginBottom: 22,
    backgroundColor: '#100F14',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
  },
  heroBg: { ...StyleSheet.absoluteFillObject },
  heroSheen: { position: 'absolute', top: 0, left: 0, right: 0, height: '45%' },
  heroInner: { padding: 22 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  heroEyebrow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroPulse: { width: 7, height: 7, borderRadius: 4, shadowOpacity: 0.9, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } },
  heroEyebrowText: { fontFamily: F.semibold, color: C.inkDim, fontSize: 11, letterSpacing: 1.6 },
  heroMeta: { fontFamily: F.medium, color: C.inkDim, fontSize: 12 },
  heroMetaBig: { fontFamily: F.medium, color: C.inkDim, fontSize: 16, marginTop: 4 },
  heroTitle: { fontFamily: F.medium, color: C.ink, fontSize: 28, lineHeight: 32, marginBottom: 18 },
  heroClock: { flexDirection: 'row', alignItems: 'flex-start' },
  heroCol: { flex: 1, alignItems: 'center' },
  heroSepCol: { width: 12, height: 44, alignItems: 'center', justifyContent: 'center' },
  heroNum: { fontFamily: F.semibold, color: C.ink, fontSize: 40, lineHeight: 44, fontVariant: ['tabular-nums'] },
  heroNumZero: { color: C.inkFaint },
  heroUnitLabel: { fontFamily: F.medium, color: C.inkDim, fontSize: 9.5, letterSpacing: 1.3, marginTop: 5 },
  heroSep: { fontFamily: F.semibold, color: 'rgba(245,243,239,0.28)', fontSize: 28, lineHeight: 30, marginTop: -2 },
  heroClockSub: { fontFamily: F.medium, color: C.inkDim, fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase' },
  heroFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 14 },
  heroFootText: { fontFamily: F.medium, color: C.inkDim, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 12 },
  heroSlot: { fontFamily: F.semibold, color: C.ink, fontSize: 13 },
  heroBar: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 14, overflow: 'hidden' },
  dottedBar: { flexDirection: 'row', gap: 1.5, alignItems: 'center' },
  heroBarFill: { height: 5, borderRadius: 3 },
  heroEmptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 9, paddingVertical: 30 },
  heroEmptyTitle: { fontFamily: F.semibold, color: C.ink, fontSize: 18 },
  heroEmptySub: { fontFamily: F.regular, color: C.inkDim, fontSize: 13, textAlign: 'center' },

  dayProgress: { marginBottom: 24 },
  segBar: { flexDirection: 'row', gap: 4 },
  seg: { flex: 1, height: 8, borderRadius: 3, backgroundColor: C.line, overflow: 'hidden' },
  segFill: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  dayMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  dayCount: { fontFamily: F.regular, color: C.inkDim, fontSize: 12 },

  timelineHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },  sectionLabel: { fontFamily: F.bold, color: C.inkFaint, fontSize: 11, letterSpacing: 1.8 },
  selectToggle: { fontFamily: F.semibold, color: C.brass, fontSize: 13 },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sortRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line },
  sortRowLabel: { fontFamily: F.semibold, color: C.ink, fontSize: 15 },
  sortRowSub: { fontFamily: F.regular, color: C.inkDim, fontSize: 12, marginTop: 2 },
  cdRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.line },
  cdTime: { fontFamily: F.semibold, color: C.brass, fontSize: 12, width: 62 },
  cdTitle: { flex: 1, fontFamily: F.medium, color: C.ink, fontSize: 13.5 },
  cdBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  cdBadgeText: { fontFamily: F.bold, fontSize: 9.5, letterSpacing: 0.3 },
  cdEmpty: { fontFamily: F.regular, color: C.inkFaint, fontSize: 13, paddingVertical: 20, textAlign: 'center' },

  task: { flexDirection: 'row', alignItems: 'stretch', gap: 12, marginBottom: 14, minHeight: 100 },
  taskCompact: { minHeight: 88, marginBottom: 12 },
  dotCol: { width: 38, position: 'relative' },
  rail: { position: 'absolute', left: 18, top: 0, bottom: -14, width: 1.5, backgroundColor: C.line },
  dot: { position: 'absolute', top: 6, left: 13, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  dotGlow: { shadowColor: C.brass, shadowOpacity: 0.6, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } },
  timeWrap: { position: 'absolute', top: 0, bottom: 0, left: 11, width: 16, alignItems: 'center', justifyContent: 'center' },
  timeV: { fontFamily: F.bold, fontSize: 12, width: 64, height: 16, lineHeight: 16, textAlign: 'center', transform: [{ rotate: '-90deg' }] },

  taskCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 18,
    padding: 15,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  taskCardActive: { borderColor: C.brass, shadowColor: C.brass, shadowOpacity: 0.22 },
  taskCardFocus: { borderColor: 'rgba(201,151,74,0.45)' },
  taskCardCompact: { paddingVertical: 12, alignItems: 'center' },
  taskCardDone: { opacity: 0.62 },
  taskCardSelected: { borderColor: C.brass, backgroundColor: 'rgba(201,151,74,0.08)' },
  compactTitle: { flex: 1, fontFamily: F.semibold, color: C.inkDim, fontSize: 14, lineHeight: 18 },
  compactHintRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  compactHint: { fontFamily: F.semibold, fontSize: 11, letterSpacing: 0.3 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: C.inkFaint, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxDone: { backgroundColor: C.green, borderColor: C.green },
  selBox: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: C.inkFaint, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  selBoxOn: { backgroundColor: C.brass, borderColor: C.brass },
  taskBody: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  taskTitle: { flex: 1, fontFamily: F.semibold, color: C.ink, fontSize: 14.5, lineHeight: 19 },
  strike: { textDecorationLine: 'line-through', textDecorationColor: C.inkFaint },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginTop: 6 },
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  catDot: { width: 7, height: 7, borderRadius: 4 },
  catText: { fontFamily: F.medium, color: C.inkDim, fontSize: 11.5, textTransform: 'capitalize' },
  metaText: { fontFamily: F.regular, color: C.inkFaint, fontSize: 11.5 },
  liveTimer: { fontFamily: F.bold, color: C.brass, fontSize: 12, fontVariant: ['tabular-nums'] },
  countChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7, backgroundColor: 'rgba(201,151,74,0.12)', borderWidth: 1, borderColor: 'rgba(201,151,74,0.28)' },
  countChipLate: { backgroundColor: 'rgba(196,108,98,0.12)', borderColor: 'rgba(196,108,98,0.32)' },
  countText: { fontFamily: F.semibold, color: C.brass, fontSize: 11, fontVariant: ['tabular-nums'] },
  delayBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  delayDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.red },
  delayText: { fontFamily: F.bold, color: C.red, fontSize: 10, letterSpacing: 0.3 },
  taskNote: { fontFamily: F.regular, color: C.inkDim, fontSize: 12.5, lineHeight: 18, marginTop: 7 },
  metaLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14, marginTop: 9 },
  metaPiece: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaLineText: { fontFamily: F.medium, color: C.inkFaint, fontSize: 11.5 },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 9,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(127,168,201,0.35)',
    backgroundColor: 'rgba(127,168,201,0.10)',
  },
  changeRowText: { fontFamily: F.semibold, color: C.ink, fontSize: 11, letterSpacing: 0.2 },
  spentBar: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.07)', marginTop: 10, overflow: 'hidden' },
  spentFill: { height: '100%', borderRadius: 2 },
  pill: { fontFamily: F.bold, fontSize: 9.5, letterSpacing: 0.5, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  pillRun: { color: C.brass, backgroundColor: C.brassSoft },
  pillPause: { color: '#D9A85C', backgroundColor: 'rgba(201,167,74,0.14)' },
  pillCancel: { color: C.red, backgroundColor: 'rgba(201,122,106,0.16)' },
  pillCarry: { color: C.inkDim, backgroundColor: 'rgba(255,255,255,0.05)' },
  prioWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  prioBar: { width: 3, borderRadius: 1.5 },
  prioLbl: { fontFamily: F.bold, fontSize: 9, letterSpacing: 0.5, marginLeft: 5, alignSelf: 'center', textTransform: 'uppercase' },

  placeholder: { alignItems: 'center', paddingVertical: 80, gap: 8 },
  tabsWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 8, paddingBottom: 4 },
  bottomWrap: { position: 'absolute', left: 22, right: 0, alignItems: 'flex-start' },
  bottomPill: {
    flexDirection: 'row',
    gap: 4,
    padding: 5,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(20,19,23,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  pillTab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 15, paddingVertical: 9, borderRadius: 999, overflow: 'hidden' },
  pillTabOnBg: { ...StyleSheet.absoluteFillObject },
  pillTabOn: { backgroundColor: C.brass },
  pillTabText: { fontFamily: F.semibold, color: C.inkDim, fontSize: 13 },
  pillTabTextOn: { color: C.bg },
  gearBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  recurBadge: { width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(156,143,208,0.16)', alignItems: 'center', justifyContent: 'center' },
  viewPad: { flex: 1, paddingHorizontal: 22, paddingTop: 10 },
  placeholderTitle: { fontFamily: F.semibold, color: C.ink, fontSize: 20 },
  placeholderSub: { fontFamily: F.regular, color: C.inkFaint, fontSize: 13 },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontFamily: F.regular, color: C.inkFaint, fontSize: 13.5 },

  fab: {
    position: 'absolute',
    right: 22,
    bottom: 34,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: C.brass,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.brass,
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },

  bulkBar: {
    position: 'absolute',
    left: 22,
    right: 22,
    bottom: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.bgSoft,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  bulkCount: { fontFamily: F.semibold, color: C.ink, fontSize: 14 },
  bulkBtns: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bulkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.brass,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  bulkBtnText: { fontFamily: F.bold, color: C.bg, fontSize: 13.5 },
  bulkCancel: { paddingVertical: 9, paddingHorizontal: 8 },
  bulkCancelText: { fontFamily: F.medium, color: C.inkDim, fontSize: 13.5 },

  // sheets / modals
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.bgSoft,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: C.line,
    padding: 22,
    paddingBottom: 40,
  },
  sheetHandle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: C.line, marginBottom: 16 },
  sheetTitle: { fontFamily: F.semibold, color: C.ink, fontSize: 18 },
  sheetSub: { fontFamily: F.regular, color: C.inkDim, fontSize: 13, marginTop: 4, marginBottom: 14 },
  histRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.line },
  histIc: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  histAct: { fontFamily: F.medium, color: C.ink, fontSize: 13.5, lineHeight: 19 },
  histMeta: { fontFamily: F.regular, color: C.inkFaint, fontSize: 11.5, marginTop: 3 },
  histDoneBtn: { marginTop: 14, paddingVertical: 14, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, alignItems: 'center' },
  histDoneText: { fontFamily: F.semibold, color: C.ink, fontSize: 15 },
  sheetNote: { fontFamily: F.regular, color: C.inkDim, fontSize: 13.5, lineHeight: 20, marginTop: -8, marginBottom: 14 },
  detailMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: -4, marginBottom: 12 },
  detailChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  detailDot: { width: 7, height: 7, borderRadius: 4 },
  detailChipText: { fontFamily: F.medium, color: C.inkDim, fontSize: 12, textTransform: 'capitalize' },
  detailTracked: { fontFamily: F.medium, color: C.inkDim, fontSize: 12.5, marginTop: -2, marginBottom: 14 },
  sheetActions: { gap: 9 },
  sheetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
  },
  sheetBtnText: { fontFamily: F.semibold, color: C.ink, fontSize: 15 },

  fieldLabel: { fontFamily: F.bold, color: C.inkFaint, fontSize: 10.5, letterSpacing: 1.4, marginTop: 16, marginBottom: 8 },
  input: {
    fontFamily: F.medium,
    color: C.ink,
    fontSize: 16,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  noteInput: { minHeight: 70, textAlignVertical: 'top' },
  weekRow: { flexDirection: 'row', gap: 7 },
  weekBtn: { flex: 1, aspectRatio: 1, maxWidth: 46, borderRadius: 999, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  weekBtnOn: { backgroundColor: C.brass, borderColor: C.brass },
  weekText: { fontFamily: F.bold, color: C.inkDim, fontSize: 13 },
  weekTextOn: { color: C.bg },
  repeatHint: { fontFamily: F.regular, color: C.inkFaint, fontSize: 11.5, marginTop: 9 },
  repeatStartRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13 },
  repeatStartLabel: { fontFamily: F.bold, color: C.inkFaint, fontSize: 10.5, letterSpacing: 1.4 },
  repeatStartVal: { fontFamily: F.semibold, color: C.brass, fontSize: 14 },
  addCatRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  addCatInput: { flex: 1, fontFamily: F.medium, color: C.ink, fontSize: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  addCatBtn: { paddingHorizontal: 16, borderRadius: 10, backgroundColor: C.brassSoft, borderWidth: 1, borderColor: C.brass, alignItems: 'center', justifyContent: 'center' },
  addCatBtnText: { fontFamily: F.semibold, color: C.brass, fontSize: 13 },
  pickerWrap: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  picker: { height: 140 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
  },
  chipActive: { backgroundColor: C.brassSoft, borderColor: C.brass },
  chipText: { fontFamily: F.medium, color: C.inkDim, fontSize: 13, textTransform: 'capitalize' },
  chipTextActive: { color: C.brass, fontFamily: F.semibold },
  saveBtn: { backgroundColor: C.brass, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 24 },
  saveBtnText: { fontFamily: F.bold, color: C.bg, fontSize: 16 },
  outlineBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 12, borderWidth: 1, borderColor: C.brass, backgroundColor: C.brassSoft },
  outlineBtnText: { fontFamily: F.semibold, color: C.brass, fontSize: 15 },
  cancelBtn: { paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { fontFamily: F.medium, color: C.inkDim, fontSize: 14 },

  dateStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  stepBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSoft },
  stepLabel: { fontFamily: F.semibold, color: C.ink, fontSize: 15 },

  conflictBox: {
    marginTop: 18,
    backgroundColor: 'rgba(217,168,92,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(217,168,92,0.4)',
    borderRadius: 12,
    padding: 14,
  },
  conflictHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  conflictTitle: { fontFamily: F.semibold, color: '#D9A85C', fontSize: 13 },
  conflictRow: { fontFamily: F.regular, color: C.inkDim, fontSize: 12.5, lineHeight: 19, marginBottom: 4 },
  conflictHint: { fontFamily: F.regular, color: C.inkFaint, fontSize: 11.5, marginTop: 4 },

  dayStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: -10, marginBottom: 22 },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statVal: { fontFamily: F.semibold, color: C.ink, fontSize: 12 },
  statLabel: { fontFamily: F.regular, color: C.inkDim, fontSize: 12 },

  slotRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 14, marginBottom: 10 },
  slotTime: { fontFamily: F.semibold, color: C.ink, fontSize: 15 },
  slotDur: { fontFamily: F.regular, color: C.inkDim, fontSize: 12, marginTop: 2 },
  slotGroup: { marginBottom: 16 },
  slotGroupHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 9 },
  slotChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slotChip: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 9 },
  slotChipText: { fontFamily: F.semibold, color: C.brass, fontSize: 13 },

  swapRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 13, marginBottom: 8 },
  swapRowOn: { borderColor: C.brass, backgroundColor: 'rgba(201,151,74,0.08)' },
  swapTime: { fontFamily: F.bold, color: C.brass, fontSize: 13, width: 64 },
  swapTitle: { flex: 1, fontFamily: F.medium, color: C.ink, fontSize: 14 },

  fabScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,5,8,0.22)' },
  fabMenu: { position: 'absolute', right: 22, bottom: 100, alignItems: 'flex-end', gap: 10 },
  fabItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fabItemLabel: { fontFamily: F.semibold, color: C.ink, fontSize: 14, backgroundColor: C.bgSoft, borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, overflow: 'hidden' },
  fabItemIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.bgSoft, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },

  closedBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: 'rgba(111,168,138,0.12)', borderWidth: 1, borderColor: 'rgba(111,168,138,0.4)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 18 },
  closedBannerText: { fontFamily: F.semibold, color: C.green, fontSize: 12.5 },
});
