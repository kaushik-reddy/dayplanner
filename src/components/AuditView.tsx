import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { SymbolView } from 'expo-symbols';

import { type Bundle, type Task, dateKey, fmtTime, getCategories, taskState } from '../lib/planner';
import { C, F } from '../lib/theme';

type DayStat = { done: number; total: number; cancelled: number; carried: number; trackedMin: number };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const PRIOS: { key: 'must' | 'high' | 'medium' | 'low'; label: string; color: string }[] = [
  { key: 'must', label: 'Must', color: '#D9645A' },
  { key: 'high', label: 'High', color: '#E0915A' },
  { key: 'medium', label: 'Medium', color: '#C9974A' },
  { key: 'low', label: 'Low', color: '#7FA8C9' },
];

function spentMs(t: Task): number {
  if (t.accumMs != null || t.runningSince != null)
    return (t.accumMs || 0) + (t.runningSince ? Date.now() - t.runningSince : 0);
  if (t.startedAt && t.completedAt) return t.completedAt - t.startedAt;
  if (t.startedAt) return Date.now() - t.startedAt;
  return 0;
}
function pausedMs(t: Task): number {
  return (t.pausedAccumMs || 0) + (t.pausedSince ? Date.now() - t.pausedSince : 0);
}
function changeCounts(t: Task): { moved: number; rescheduled: number; swapped: number } {
  const c = { moved: 0, rescheduled: 0, swapped: 0 } as Record<string, number>;
  (Array.isArray(t.changes) ? t.changes : []).forEach((x: any) => {
    if (x && c[x.type] != null) c[x.type]++;
  });
  return c as { moved: number; rescheduled: number; swapped: number };
}
function fmtMin(mins: number): string {
  if (!mins) return '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return (h ? `${h}h` : '') + (h && m ? ' ' : '') + (m ? `${m}m` : h ? '' : '0m');
}

function heatColor(ratio: number, total: number): string {
  if (total === 0) return 'rgba(255,255,255,0.05)';
  if (ratio === 0) return 'rgba(111,168,138,0.18)';
  if (ratio < 0.5) return 'rgba(111,168,138,0.4)';
  if (ratio < 1) return 'rgba(111,168,138,0.66)';
  return C.green;
}

export default function AuditView({ bundle, bottomInset = 70 }: { bundle: Bundle | null; bottomInset?: number }) {
  const stats = useMemo(() => {
    const days = bundle?.days ?? {};
    const todayKey = dateKey(new Date());
    const perDay: Record<string, DayStat> = {};
    const all: Task[] = [];
    let totalDone = 0;
    let totalTasks = 0;
    let totalCancelled = 0;
    let totalCarried = 0;
    let totalSpentMs = 0;
    let totalPlannedMs = 0;
    let totalPausedMs = 0;
    let pausedEvents = 0;
    let tracked = 0;
    let onTime = 0;
    let overCount = 0;
    let underCount = 0;
    let driftSum = 0;
    let recurringN = 0;
    let moves = 0;
    let resch = 0;
    let swaps = 0;
    const hourBuckets = Array(24).fill(0);
    const dowSpent = Array(7).fill(0);
    const prioStats: Record<string, { t: number; d: number }> = {
      must: { t: 0, d: 0 },
      high: { t: 0, d: 0 },
      medium: { t: 0, d: 0 },
      low: { t: 0, d: 0 },
    };
    const catCount: Record<string, number> = {};
    let punctOn = 0;
    let punctLate = 0;
    let punctEarly = 0;
    let punctN = 0;
    let delaySum = 0;

    for (const [key, day] of Object.entries(days)) {
      if (key > todayKey) continue;
      const wd = new Date(key + 'T00:00:00').getDay();
      let done = 0;
      let total = 0;
      let cancelled = 0;
      let carried = 0;
      let trackedMsDay = 0;
      for (const t of day.tasks || []) {
        all.push(t);
        const st = taskState(t);
        if (st === 'cancelled') {
          cancelled++;
          totalCancelled++;
          continue;
        }
        if (st === 'carried') {
          carried++;
          totalCarried++;
          continue;
        }
        total++;
        if (st === 'completed') done++;
        if (t.recurId) recurringN++;
        const sp = spentMs(t);
        const planned = (t.duration || 0) * 60000;
        totalSpentMs += sp;
        totalPlannedMs += planned;
        trackedMsDay += sp;
        totalPausedMs += pausedMs(t);
        if (t.pausedAccumMs || t.pausedSince) pausedEvents++;
        dowSpent[wd] += sp;
        const cc = changeCounts(t);
        moves += cc.moved;
        resch += cc.rescheduled;
        swaps += cc.swapped;
        if (t.startedAt && t.completedAt && planned > 0) {
          tracked++;
          const diff = sp - planned;
          driftSum += diff;
          if (sp <= planned) {
            onTime++;
            if (sp < planned) underCount++;
          } else overCount++;
        }
        if (t.startedAt) {
          const sd = new Date(t.startedAt);
          hourBuckets[sd.getHours()]++;
          if (t.time && dateKey(sd) === key) {
            const sched = (() => {
              const [h, m] = (t.time || '0:0').split(':').map(Number);
              return h * 60 + m;
            })();
            const startMin = sd.getHours() * 60 + sd.getMinutes();
            const delay = startMin - sched;
            punctN++;
            delaySum += delay;
            if (delay > 10) punctLate++;
            else if (delay < -10) punctEarly++;
            else punctOn++;
          }
        }
        const p = t.priority && prioStats[t.priority] ? t.priority : 'medium';
        prioStats[p].t++;
        if (st === 'completed') prioStats[p].d++;
        for (const c of getCategories(t)) {
          const k = String(c).replace(/^#/, '').toLowerCase();
          if (k) catCount[k] = (catCount[k] || 0) + 1;
        }
      }
      perDay[key] = { done, total, cancelled, carried, trackedMin: Math.round(trackedMsDay / 60000) };
      totalDone += done;
      totalTasks += total;
    }

    const completedDays = new Set<string>();
    for (const [key, day] of Object.entries(days)) {
      if (key > todayKey) continue;
      if ((day.tasks || []).some((t) => taskState(t) === 'completed')) completedDays.add(key);
    }
    const today = new Date();
    let streak = 0;
    let si = completedDays.has(dateKey(today)) ? 0 : 1;
    for (; si < 400; si++) {
      const d = new Date(today);
      d.setDate(d.getDate() - si);
      if (completedDays.has(dateKey(d))) streak++;
      else break;
    }
    let longestStreak = 0;
    {
      let run = 0;
      let prev: Date | null = null;
      [...completedDays].sort().forEach((k) => {
        const d = new Date(k + 'T00:00:00');
        if (prev && Math.round((d.getTime() - prev.getTime()) / 86400000) === 1) run++;
        else run = 1;
        if (run > longestStreak) longestStreak = run;
        prev = d;
      });
    }
    const activeDays = completedDays.size;

    const cells: { key: string; ratio: number; total: number }[] = [];
    for (let i = 90; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const k = dateKey(d);
      const pd = perDay[k];
      const total = pd?.total ?? 0;
      cells.push({ key: k, ratio: total ? pd!.done / total : 0, total });
    }
    const bars: { key: string; min: number; label: string }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const k = dateKey(d);
      bars.push({ key: k, min: perDay[k]?.trackedMin ?? 0, label: String(d.getDate()) });
    }

    const tMin = Math.round(totalSpentMs / 60000);
    const pMin = Math.round(totalPlannedMs / 60000);
    const pausedMin = Math.round(totalPausedMs / 60000);
    const dayCountN = Object.keys(perDay).filter((k) => perDay[k].total > 0 || perDay[k].cancelled > 0).length;
    const planChanges = moves + resch + swaps;
    const topCat = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0];
    const avgDur = totalTasks ? Math.round(pMin / totalTasks) : 0;
    const avgDelay = punctN ? Math.round(delaySum / punctN) : null;
    const driftAvg = tracked ? Math.round(driftSum / tracked / 60000) : 0;
    const dowDoneIdx = (() => {
      let bi = 0;
      for (let i = 1; i < 7; i++) if (dowSpent[i] > dowSpent[bi]) bi = i;
      return dowSpent[bi] > 0 ? bi : -1;
    })();
    const hourPeak = (() => {
      let bi = 0;
      for (let i = 1; i < 24; i++) if (hourBuckets[i] > hourBuckets[bi]) bi = i;
      return hourBuckets[bi] > 0 ? bi : -1;
    })();

    return {
      perDay,
      totalDone,
      totalTasks,
      totalCancelled,
      totalCarried,
      recurringN,
      tMin,
      pMin,
      pausedMin,
      pausedEvents,
      tracked,
      onTime,
      overCount,
      underCount,
      driftAvg,
      completion: totalTasks ? Math.round((totalDone / totalTasks) * 100) : 0,
      onTimePct: tracked ? Math.round((onTime / tracked) * 100) : null,
      streak,
      longestStreak,
      activeDays,
      dayCountN,
      planChanges,
      moves,
      resch,
      swaps,
      cells,
      bars,
      hourBuckets,
      hourPeak,
      dowSpent,
      dowDoneIdx,
      prioStats,
      avgDur,
      punctOn,
      punctLate,
      punctEarly,
      punctN,
      avgDelay,
      bestWeekday: dowDoneIdx >= 0 ? WEEKDAYS[dowDoneIdx] : '—',
      topCat: topCat ? topCat[0] : '—',
    };
  }, [bundle]);

  const columns = useMemo(() => {
    const first = stats.cells[0];
    const pad = first ? new Date(first.key + 'T00:00:00').getDay() : 0;
    const padded: ({ key: string; ratio: number; total: number } | null)[] = [
      ...Array(pad).fill(null),
      ...stats.cells,
    ];
    const cols: (typeof padded)[] = [];
    for (let i = 0; i < padded.length; i += 7) cols.push(padded.slice(i, i + 7));
    return cols;
  }, [stats.cells]);

  const maxBar = Math.max(60, ...stats.bars.map((b) => b.min));
  const maxHour = Math.max(1, ...stats.hourBuckets);
  const maxDow = Math.max(1, ...stats.dowSpent);
  const exact = stats.onTime - stats.underCount;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: bottomInset }}>
      <Text style={styles.kicker}>ALL‑TIME</Text>
      <Text style={styles.h1}>Your history</Text>
      <Text style={styles.subtitle}>
        {stats.dayCountN ? `${stats.dayCountN} day${stats.dayCountN > 1 ? 's' : ''} logged` : 'No history yet'}
      </Text>

      {/* Hero ring */}
      <View style={styles.hero}>
        <View style={styles.ringWrap}>
          <Svg width={132} height={132} viewBox="0 0 120 120">
            <Defs>
              <LinearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor="#C9974A" />
                <Stop offset="1" stopColor="#E0B36A" />
              </LinearGradient>
            </Defs>
            <Circle cx={60} cy={60} r={52} stroke="rgba(255,255,255,0.07)" strokeWidth={10} fill="none" />
            <Circle
              cx={60}
              cy={60}
              r={52}
              stroke="url(#ringGrad)"
              strokeWidth={10}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 52}
              strokeDashoffset={(2 * Math.PI * 52) * (1 - stats.completion / 100)}
              transform="rotate(-90 60 60)"
            />
          </Svg>
          <View style={styles.ringCenter}>
            <Text style={styles.ringPct}>
              {stats.completion}
              <Text style={styles.ringPctSign}>%</Text>
            </Text>
            <Text style={styles.ringLbl}>Completed</Text>
          </View>
        </View>
        <View style={styles.heroMetrics}>
          <HeroRow icon="checkmark" val={`${stats.totalDone}/${stats.totalTasks}`} lbl="tasks finished" />
          <HeroRow icon="clock" val={fmtMin(stats.tMin)} lbl="time tracked" />
          <HeroRow
            icon="target"
            val={stats.onTimePct == null ? '—' : `${stats.onTimePct}%`}
            lbl={stats.onTimePct == null ? 'no tracked tasks' : 'finished on time'}
            tone={stats.onTimePct == null ? undefined : stats.overCount ? 'warn' : 'good'}
          />
          <HeroRow icon="flag.fill" val={`${stats.streak}`} lbl="day streak" tone={stats.streak ? 'good' : undefined} />
        </View>
      </View>

      {/* Stat cards */}
      <View style={styles.cardGrid}>
        <StatCard lbl="Completed" val={`${stats.totalDone}/${stats.totalTasks}`} sub={stats.totalTasks ? `${stats.completion}% all‑time` : 'no tasks'} />
        <StatCard lbl="Time tracked" val={fmtMin(stats.tMin)} sub={stats.avgDur ? `~${stats.avgDur}m avg / task` : 'actually spent'} />
        <StatCard lbl="On time" val={stats.tracked ? `${stats.onTime}/${stats.tracked}` : '—'} sub={stats.overCount ? `${stats.overCount} ran over` : 'within plan'} tone={stats.tracked ? (stats.overCount ? 'warn' : 'good') : undefined} />
        <StatCard lbl="Paused" val={fmtMin(stats.pausedMin)} sub={stats.pausedEvents ? `${stats.pausedEvents}× paused` : 'never paused'} />
        <StatCard lbl="Plan changes" val={`${stats.planChanges}`} sub={stats.planChanges ? `${stats.resch} resched · ${stats.moves} moved` : 'stuck to plan'} tone={stats.planChanges > stats.totalTasks ? 'warn' : undefined} />
        <StatCard lbl="Cancelled" val={`${stats.totalCancelled}`} sub={stats.totalTasks ? `${Math.round((stats.totalCancelled / (stats.totalTasks + stats.totalCancelled || 1)) * 100)}% of tasks` : 'none'} tone={stats.totalCancelled ? 'warn' : undefined} />
        <StatCard lbl="Carried" val={`${stats.totalCarried}`} sub={stats.totalCarried ? 'pushed to later' : 'none deferred'} />
        <StatCard lbl="Streak" val={`${stats.streak}`} sub={stats.streak ? 'days in a row' : 'start today'} tone={stats.streak ? 'good' : undefined} />
        <StatCard lbl="Best streak" val={`${stats.longestStreak}`} sub={stats.longestStreak ? 'days record' : '—'} />
        <StatCard lbl="Active days" val={`${stats.activeDays}`} sub={stats.dayCountN ? `of ${stats.dayCountN} logged` : 'none yet'} />
        <StatCard lbl="On‑time start" val={stats.punctN ? `${Math.round((stats.punctOn / stats.punctN) * 100)}%` : '—'} sub={stats.punctN ? (stats.avgDelay! > 0 ? `~${stats.avgDelay}m late avg` : stats.avgDelay! < 0 ? `~${-stats.avgDelay!}m early avg` : 'right on time') : 'no starts'} tone={stats.punctN ? (stats.punctOn / stats.punctN >= 0.6 ? 'good' : 'warn') : undefined} />
        <StatCard lbl="Recurring" val={`${stats.recurringN}`} sub={stats.recurringN ? 'from routines' : 'none'} />
      </View>

      {/* Consistency heatmap */}
      <View style={styles.chartCard}>
        <View style={styles.chartHead}>
          <Text style={styles.chTitle}>Consistency</Text>
          <Text style={styles.chNote}>last 13 weeks</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.heatRow}>
            {columns.map((col, ci) => (
              <View key={ci} style={styles.heatCol}>
                {Array.from({ length: 7 }).map((_, ri) => {
                  const cell = col[ri];
                  return (
                    <View
                      key={ri}
                      style={[
                        styles.heatCell,
                        { backgroundColor: cell ? heatColor(cell.ratio, cell.total) : 'transparent' },
                      ]}
                    />
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
        <View style={styles.legend}>
          <Text style={styles.legendText}>Less</Text>
          {[0.05, 0.18, 0.4, 0.66, 1].map((o, i) => (
            <View
              key={i}
              style={[
                styles.legendCell,
                { backgroundColor: i === 0 ? 'rgba(255,255,255,0.05)' : `rgba(111,168,138,${o})` },
              ]}
            />
          ))}
          <Text style={styles.legendText}>More</Text>
        </View>
      </View>

      {/* Activity bars */}
      <View style={styles.chartCard}>
        <View style={styles.chartHead}>
          <Text style={styles.chTitle}>Activity</Text>
          <Text style={styles.chNote}>last 14 days · time tracked</Text>
        </View>
        <View style={styles.bars}>
          {stats.bars.map((b) => (
            <View key={b.key} style={styles.barCol}>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      height: `${Math.max(3, Math.round((b.min / maxBar) * 100))}%`,
                      backgroundColor: b.min > 0 ? C.brass : 'rgba(255,255,255,0.06)',
                    },
                  ]}
                />
              </View>
              <Text style={styles.barLabel}>{b.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* When you work (hours) */}
      <View style={styles.chartCard}>
        <View style={styles.chartHead}>
          <Text style={styles.chTitle}>When you work</Text>
          <Text style={styles.chNote}>task starts by hour</Text>
        </View>
        <View style={styles.hourBars}>
          {stats.hourBuckets.map((v, h) => (
            <View key={h} style={styles.hourCol}>
              <View style={styles.hourTrack}>
                <View
                  style={[
                    styles.hourFill,
                    {
                      height: `${Math.max(2, Math.round((v / maxHour) * 100))}%`,
                      backgroundColor: v > 0 ? (h === stats.hourPeak ? C.brass : 'rgba(201,151,74,0.5)') : 'rgba(255,255,255,0.06)',
                    },
                  ]}
                />
              </View>
            </View>
          ))}
        </View>
        <View style={styles.hourAxis}>
          <Text style={styles.hourAxisText}>12a</Text>
          <Text style={styles.hourAxisText}>6a</Text>
          <Text style={styles.hourAxisText}>12p</Text>
          <Text style={styles.hourAxisText}>6p</Text>
          <Text style={styles.hourAxisText}>11p</Text>
        </View>
      </View>

      {/* Day of week */}
      <View style={styles.chartCard}>
        <View style={styles.chartHead}>
          <Text style={styles.chTitle}>By day of week</Text>
          <Text style={styles.chNote}>time tracked</Text>
        </View>
        <View style={styles.bars}>
          {stats.dowSpent.map((ms, i) => (
            <View key={i} style={styles.barCol}>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      height: `${Math.max(3, Math.round((ms / maxDow) * 100))}%`,
                      backgroundColor: i === stats.dowDoneIdx ? C.brass : ms > 0 ? 'rgba(201,151,74,0.5)' : 'rgba(255,255,255,0.06)',
                    },
                  ]}
                />
              </View>
              <Text style={styles.barLabel}>{DOW[i]}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Priority breakdown */}
      <View style={styles.chartCard}>
        <Text style={styles.chTitle}>Priority follow‑through</Text>
        <View style={{ marginTop: 12, gap: 12 }}>
          {PRIOS.map((p) => {
            const s = stats.prioStats[p.key];
            const pct = s.t ? Math.round((s.d / s.t) * 100) : 0;
            return (
              <View key={p.key}>
                <View style={styles.prioHead}>
                  <Text style={[styles.prioLabel, { color: p.color }]}>{p.label}</Text>
                  <Text style={styles.prioVal}>
                    {s.d}/{s.t} {s.t ? `· ${pct}%` : ''}
                  </Text>
                </View>
                <View style={styles.prioTrack}>
                  <View style={[styles.prioFill, { width: `${pct}%`, backgroundColor: p.color }]} />
                </View>
              </View>
            );
          })}
        </View>
      </View>

      {/* Accuracy + punctuality */}
      <View style={styles.chartCard}>
        <Text style={styles.chTitle}>Estimate accuracy</Text>
        {stats.tracked === 0 ? (
          <Text style={styles.emptyNote}>Track a few tasks to see how close your estimates are.</Text>
        ) : (
          <>
            <View style={styles.segBar}>
              {stats.underCount > 0 && <View style={{ flex: stats.underCount, backgroundColor: C.green }} />}
              {exact > 0 && <View style={{ flex: exact, backgroundColor: C.brass }} />}
              {stats.overCount > 0 && <View style={{ flex: stats.overCount, backgroundColor: C.red }} />}
            </View>
            <View style={styles.segLegend}>
              <SegKey color={C.green} label={`Under · ${stats.underCount}`} />
              <SegKey color={C.brass} label={`On · ${exact}`} />
              <SegKey color={C.red} label={`Over · ${stats.overCount}`} />
            </View>
            <Text style={styles.emptyNote}>
              {stats.driftAvg > 0
                ? `Runs about ${fmtMin(stats.driftAvg)} over plan on average.`
                : stats.driftAvg < 0
                  ? `Finishes about ${fmtMin(-stats.driftAvg)} ahead of plan.`
                  : 'Right on your estimates.'}
            </Text>
          </>
        )}
      </View>

      <View style={styles.chartCard}>
        <Text style={styles.chTitle}>Punctuality</Text>
        {stats.punctN === 0 ? (
          <Text style={styles.emptyNote}>Start tasks at their scheduled time to track punctuality.</Text>
        ) : (
          <>
            <View style={styles.segBar}>
              {stats.punctEarly > 0 && <View style={{ flex: stats.punctEarly, backgroundColor: C.blue }} />}
              {stats.punctOn > 0 && <View style={{ flex: stats.punctOn, backgroundColor: C.green }} />}
              {stats.punctLate > 0 && <View style={{ flex: stats.punctLate, backgroundColor: C.red }} />}
            </View>
            <View style={styles.segLegend}>
              <SegKey color={C.blue} label={`Early · ${stats.punctEarly}`} />
              <SegKey color={C.green} label={`On time · ${stats.punctOn}`} />
              <SegKey color={C.red} label={`Late · ${stats.punctLate}`} />
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

type Tone = 'good' | 'warn' | undefined;

function HeroRow({ icon, val, lbl, tone }: { icon: string; val: string; lbl: string; tone?: Tone }) {
  const col = tone === 'good' ? C.green : tone === 'warn' ? C.amber : C.ink;
  return (
    <View style={styles.hmRow}>
      <SymbolView name={icon as any} size={14} tintColor={C.inkDim} fallback={<Text>•</Text>} />
      <Text style={[styles.hmVal, { color: col }]}>{val}</Text>
      <Text style={styles.hmLbl}>{lbl}</Text>
    </View>
  );
}

function StatCard({ lbl, val, sub, tone }: { lbl: string; val: string; sub: string; tone?: Tone }) {
  const col = tone === 'good' ? C.green : tone === 'warn' ? C.amber : C.ink;
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLbl}>{lbl}</Text>
      <Text style={[styles.statVal, { color: col }]}>{val}</Text>
      <Text style={styles.statSub}>{sub}</Text>
    </View>
  );
}

function SegKey({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.segKey}>
      <View style={[styles.segDot, { backgroundColor: color }]} />
      <Text style={styles.segKeyText}>{label}</Text>
    </View>
  );
}

type Insight = { tone: string; ic: string; head: string; text: string };

const ACT_META: Record<string, { ic: string; color: string; verb: string }> = {
  created: { ic: 'plus', color: '#7FA8C9', verb: 'Added' },
  edited: { ic: 'pencil', color: '#9A968D', verb: 'Edited' },
  started: { ic: 'play.fill', color: '#C9974A', verb: 'Started' },
  paused: { ic: 'pause.fill', color: '#D9A85C', verb: 'Paused' },
  resumed: { ic: 'play.fill', color: '#C9974A', verb: 'Resumed' },
  completed: { ic: 'checkmark', color: '#6FA88A', verb: 'Completed' },
  cancelled: { ic: 'xmark', color: '#C97A6A', verb: 'Cancelled' },
  reopened: { ic: 'arrow.uturn.backward', color: '#9A968D', verb: 'Reopened' },
  moved: { ic: 'arrow.right', color: '#7FA8C9', verb: 'Moved' },
  swapped: { ic: 'arrow.left.arrow.right', color: '#7FA8C9', verb: 'Swapped' },
  carried: { ic: 'arrow.uturn.forward', color: '#D9A85C', verb: 'Carried' },
  deleted: { ic: 'trash', color: '#C97A6A', verb: 'Deleted' },
};
function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  kicker: { fontFamily: F.semibold, color: C.brass, fontSize: 12, letterSpacing: 2, marginBottom: 4 },
  h1: { fontFamily: F.medium, color: C.ink, fontSize: 26 },
  subtitle: { fontFamily: F.regular, color: C.inkDim, fontSize: 13, marginTop: 2, marginBottom: 18 },

  hero: { flexDirection: 'row', alignItems: 'center', gap: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 18, padding: 18, marginBottom: 16 },
  ringWrap: { width: 132, height: 132, alignItems: 'center', justifyContent: 'center' },
  ringCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  ringPct: { fontFamily: F.bold, color: C.ink, fontSize: 32 },
  ringPctSign: { fontFamily: F.semibold, color: C.inkDim, fontSize: 16 },
  ringLbl: { fontFamily: F.regular, color: C.inkDim, fontSize: 11, marginTop: -2 },
  heroMetrics: { flex: 1, gap: 11 },
  hmRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hmVal: { fontFamily: F.bold, color: C.ink, fontSize: 15, minWidth: 52 },
  hmLbl: { flex: 1, fontFamily: F.regular, color: C.inkDim, fontSize: 11.5 },

  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  statCard: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 0,
    minHeight: 86,
    justifyContent: 'flex-start',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    padding: 13,
  },
  statLbl: { fontFamily: F.semibold, color: C.inkDim, fontSize: 11, lineHeight: 14, minHeight: 28 },
  statVal: { fontFamily: F.bold, fontSize: 20, marginTop: 2 },
  statSub: { fontFamily: F.regular, color: C.inkFaint, fontSize: 10.5, marginTop: 3 },

  chartCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  chartHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  chTitle: { fontFamily: F.semibold, color: C.ink, fontSize: 14 },
  chNote: { fontFamily: F.regular, color: C.inkFaint, fontSize: 11.5 },

  insight: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  insIc: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  insHead: { fontFamily: F.semibold, color: C.ink, fontSize: 13.5 },
  insText: { fontFamily: F.regular, color: C.inkDim, fontSize: 12, marginTop: 1, lineHeight: 16 },
  actRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  actIc: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  actText: { fontFamily: F.medium, color: C.ink, fontSize: 13 },
  actDetail: { fontFamily: F.regular, color: C.inkFaint, fontSize: 11, marginTop: 1 },
  actTime: { fontFamily: F.regular, color: C.inkFaint, fontSize: 11 },

  heatRow: { flexDirection: 'row', gap: 3 },
  heatCol: { gap: 3 },
  heatCell: { width: 11, height: 11, borderRadius: 2.5 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12 },
  legendText: { fontFamily: F.regular, color: C.inkFaint, fontSize: 10 },
  legendCell: { width: 11, height: 11, borderRadius: 2.5 },

  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: 110 },
  barCol: { flex: 1, alignItems: 'center', gap: 6 },
  barTrack: { width: '100%', height: 90, justifyContent: 'flex-end', borderRadius: 4, overflow: 'hidden' },
  barFill: { width: '100%', borderRadius: 4 },
  barLabel: { fontFamily: F.regular, color: C.inkFaint, fontSize: 9 },

  hourBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 80 },
  hourCol: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  hourTrack: { width: '100%', height: '100%', justifyContent: 'flex-end', borderRadius: 2, overflow: 'hidden' },
  hourFill: { width: '100%', borderRadius: 2 },
  hourAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 },
  hourAxisText: { fontFamily: F.regular, color: C.inkFaint, fontSize: 9.5 },

  prioHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  prioLabel: { fontFamily: F.semibold, fontSize: 12.5 },
  prioVal: { fontFamily: F.regular, color: C.inkDim, fontSize: 12 },
  prioTrack: { height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' },
  prioFill: { height: '100%', borderRadius: 4 },

  segBar: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', marginTop: 14, backgroundColor: 'rgba(255,255,255,0.05)' },
  segLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12 },
  segKey: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  segDot: { width: 9, height: 9, borderRadius: 5 },
  segKeyText: { fontFamily: F.medium, color: C.inkDim, fontSize: 12 },
  emptyNote: { fontFamily: F.regular, color: C.inkDim, fontSize: 12.5, marginTop: 12, lineHeight: 18 },
});
