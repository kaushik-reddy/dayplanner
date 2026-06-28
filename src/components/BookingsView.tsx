import DateTimePicker from '@react-native-community/datetimepicker';
import * as Clipboard from 'expo-clipboard';
import { SymbolView } from 'expo-symbols';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { type Bundle, fmtTime } from '../lib/planner';
import {
  type Booking,
  type BookConfig,
  type OwnerData,
  computeBusy,
  deviceTz,
  gauthStartLink,
  manageBooking,
  minToLabel,
  parseConfig,
  publicLink,
  publishBooking,
  pullBookings,
  reconcileBookings,
  randId,
  statusMeta,
} from '../lib/bookings';
import { C, F } from '../lib/theme';
import { LiveActivity } from '../../modules/live-activity';
const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const pad2 = (n: number) => String(n).padStart(2, '0');

function SetupRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.setupRow}>
      <SymbolView name={icon as any} size={15} tintColor={C.brass} fallback={<Text>•</Text>} />
      <Text style={styles.setupRowText}>{text}</Text>
    </View>
  );
}

function keyOf(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
const SCHED_H0 = 7; // 7am
const SCHED_H1 = 22; // 10pm
const SCHED_PXH = 48; // px per hour

function BookingCalendar({
  bookings,
  selectedDay,
  onPickDay,
  onOpenBooking,
}: {
  bookings: Booking[];
  selectedDay: string | null;
  onPickDay: (k: string | null) => void;
  onOpenBooking: (b: Booking) => void;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = keyOf(today);
  const selKey = selectedDay || todayKey;
  const sel = new Date(selKey + 'T00:00:00');
  const weekStart = new Date(sel);
  weekStart.setDate(sel.getDate() - sel.getDay());
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });
  const dayMeta = bookings.reduce(
    (m: Record<string, { active: number; cancelled: number }>, b) => {
      const e = m[b.date] || (m[b.date] = { active: 0, cancelled: 0 });
      if (b.status === 'accepted' || b.status === 'pending' || b.status === 'reschedule_proposed') e.active++;
      else if (b.status === 'cancelled') e.cancelled++;
      return m;
    },
    {},
  );
  const shiftWeek = (delta: number) => {
    const d = new Date(sel);
    d.setDate(sel.getDate() + delta * 7);
    onPickDay(keyOf(d));
  };

  const totalH = (SCHED_H1 - SCHED_H0) * SCHED_PXH;
  const dayBks = bookings
    .filter(
      (b) =>
        b.date === selKey &&
        (b.status === 'accepted' ||
          b.status === 'pending' ||
          b.status === 'reschedule_proposed' ||
          b.status === 'cancelled'),
    )
    .sort((a, b) => timeToMin(a.time) - timeToMin(b.time));
  const nowD = new Date();
  const nowMinOfDay = nowD.getHours() * 60 + nowD.getMinutes();
  const showNow = selKey === todayKey && nowMinOfDay >= SCHED_H0 * 60 && nowMinOfDay <= SCHED_H1 * 60;

  const monthLbl = sel.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <View style={styles.calCard}>
      <View style={styles.calHead}>
        <Text style={styles.calTitle}>{monthLbl}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable style={styles.calNav} onPress={() => shiftWeek(-1)} hitSlop={6}>
            <SymbolView name="chevron.left" size={14} tintColor={C.inkDim} fallback={<Text style={{ color: C.inkDim }}>‹</Text>} />
          </Pressable>
          <Pressable style={styles.calNav} onPress={() => onPickDay(todayKey)} hitSlop={6}>
            <Text style={styles.calTodayBtn}>Today</Text>
          </Pressable>
          <Pressable style={styles.calNav} onPress={() => shiftWeek(1)} hitSlop={6}>
            <SymbolView name="chevron.right" size={14} tintColor={C.inkDim} fallback={<Text style={{ color: C.inkDim }}>›</Text>} />
          </Pressable>
        </View>
      </View>

      {/* Week strip */}
      <View style={styles.weekStrip}>
        {weekDays.map((d) => {
          const k = keyOf(d);
          const isSel = k === selKey;
          const isToday = k === todayKey;
          const dm = dayMeta[k] || { active: 0, cancelled: 0 };
          const dotColor = dm.active ? C.brass : dm.cancelled ? C.red : 'transparent';
          return (
            <Pressable key={k} style={styles.weekDay} onPress={() => onPickDay(k)}>
              <Text style={[styles.weekDow, isSel && { color: C.brass }]}>{WD[d.getDay()]}</Text>
              <View style={[styles.weekNumWrap, isToday && styles.weekNumToday, isSel && styles.weekNumSel]}>
                <Text style={[styles.weekNum, (isSel || isToday) && { color: isSel ? C.bg : C.brass, fontFamily: F.bold }]}>
                  {d.getDate()}
                </Text>
              </View>
              <View style={[styles.weekDot, { backgroundColor: dotColor }]} />
            </Pressable>
          );
        })}
      </View>

      {/* Day schedule (Outlook/Teams-style) */}
      <View style={[styles.schedule, { height: totalH }]}>
        {Array.from({ length: SCHED_H1 - SCHED_H0 + 1 }, (_, i) => {
          const h = SCHED_H0 + i;
          return (
            <View key={h} style={[styles.schedHourRow, { top: i * SCHED_PXH }]}>
              <Text style={styles.schedHourLabel}>{minLabel(h * 60)}</Text>
              <View style={styles.schedHourLine} />
            </View>
          );
        })}
        {showNow && (
          <View style={[styles.nowLine, { top: ((nowMinOfDay - SCHED_H0 * 60) / 60) * SCHED_PXH }]}>
            <View style={styles.nowDot} />
            <View style={styles.nowBar} />
          </View>
        )}
        {dayBks.map((b) => {
          const start = timeToMin(b.time);
          const dur = Math.max(b.duration || 30, 20);
          const top = Math.max(0, ((start - SCHED_H0 * 60) / 60) * SCHED_PXH);
          const height = Math.max(22, (dur / 60) * SCHED_PXH - 2);
          const meta = statusMeta(b.status);
          const isCancelled = b.status === 'cancelled';
          return (
            <Pressable
              key={b.id}
              style={[
                styles.schedBlock,
                { top, height, backgroundColor: meta.color + (isCancelled ? '12' : '26'), borderLeftColor: meta.color },
                isCancelled && styles.schedBlockCancelled,
              ]}
              onPress={() => onOpenBooking(b)}>
              <Text
                style={[styles.schedBlockText, { color: meta.color }, isCancelled && styles.schedStrike]}
                numberOfLines={1}>
                {b.name || 'Guest'}
              </Text>
              <Text style={[styles.schedBlockSub, isCancelled && styles.schedStrike]} numberOfLines={1}>
                {fmtTime(b.time)}
                {b.duration ? ` · ${b.duration}m` : ''} · {meta.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {dayBks.length === 0 && (
        <Text style={styles.schedEmpty}>Nothing booked on this day.</Text>
      )}
    </View>
  );
}

function timeToMin(t: string): number {
  const [h, m] = (t || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function minLabel(m: number): string {
  const h = Math.floor(m / 60);
  const period = h >= 12 ? 'pm' : 'am';
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return `${hh}${period}`;
}

function fmtDate(d: string) {
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return d;
  }
}

function BookingCard({
  b,
  onAction,
  onOpen,
}: {
  b: Booking;
  onAction: (action: string, id: string) => void;
  onOpen: (b: Booking) => void;
}) {
  const meta = statusMeta(b.status);
  const isPending = b.status === 'pending';
  const isProposed = b.status === 'reschedule_proposed';
  const prop = isProposed && b.proposed ? b.proposed : null;
  return (
    <Pressable style={styles.card} onPress={() => onOpen(b)}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardName} numberOfLines={1}>
            {b.name || 'Guest'}
          </Text>
          {prop ? (
            <Text style={styles.cardWhen}>
              <Text style={styles.cardWhenStrike}>{fmtTime(b.time)}</Text>
              {'  →  '}
              {fmtDate(prop.date)} · {fmtTime(prop.time)}
              {prop.duration ? ` · ${prop.duration}m` : ''}
            </Text>
          ) : (
            <Text style={styles.cardWhen}>
              {fmtDate(b.date)} · {fmtTime(b.time)}
              {b.duration ? ` · ${b.duration}m` : ''}
            </Text>
          )}
        </View>
        <View style={[styles.badge, { backgroundColor: meta.color + '22' }]}>
          <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      {!!b.note && (
        <Text style={styles.cardNote} numberOfLines={3}>
          “{b.note}”
        </Text>
      )}
      {!!b.email && <Text style={styles.cardEmail}>{b.email}</Text>}

      {!!b.meetLink && b.status === 'accepted' && (
        <Pressable style={styles.meetBtn} onPress={() => Linking.openURL(b.meetLink!)}>
          <SymbolView name="video.fill" size={14} tintColor={C.blue} fallback={<Text>▶</Text>} />
          <Text style={styles.meetBtnText}>Join Google Meet</Text>
        </Pressable>
      )}

      {isPending && (
        <View style={styles.cardActions}>
          <Pressable
            style={[styles.actBtn, styles.actAccept]}
            onPress={() => onAction('accept', b.id)}>
            <Text style={styles.actAcceptText}>Accept</Text>
          </Pressable>
          <Pressable
            style={[styles.actBtn, styles.actDecline]}
            onPress={() => onAction('decline', b.id)}>
            <Text style={styles.actDeclineText}>Decline</Text>
          </Pressable>
        </View>
      )}
      {isProposed && (
        <View style={styles.awaitRow}>
          <SymbolView name="clock.arrow.circlepath" size={13} tintColor={C.amber} fallback={<Text style={{ color: C.amber }}>⏳</Text>} />
          <Text style={styles.awaitText}>New time sent — waiting for {b.name || 'the guest'} to accept</Text>
        </View>
      )}
    </Pressable>
  );
}

// Module-level cache so re-entering the Bookings tab shows data instantly and
// refreshes silently in the background (no full-screen spinner every visit).
const bkCache: Record<string, OwnerData> = {};

export default function BookingsView({
  token,
  secret,
  bundle,
  onMutate,
  bottomInset = 80,
}: {
  token?: string;
  secret?: string;
  bundle?: Bundle | null;
  onMutate?: (fn: (b: Bundle) => void) => void;
  bottomInset?: number;
}) {
  const [data, setData] = useState<OwnerData | null>(() => (token ? bkCache[token] ?? null : null));
  const [loading, setLoading] = useState(() => !(token && bkCache[token]));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Booking | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [meetOpen, setMeetOpen] = useState(false);
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const cfg = parseConfig(bundle?.booking?.planner_book_config);
  const bundleRef = useRef(bundle);
  bundleRef.current = bundle;

  const load = useCallback(async () => {
    if (!token || !secret) {
      setLoading(false);
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      const d = await pullBookings(token, secret);
      setData(d);
      bkCache[token] = d;
      if (onMutate) onMutate((b) => reconcileBookings(b, d.bookings));
      let finalBookings = d.bookings;
      // First time (or server lost it): publish config + busy so the link goes live.
      if (!d.exists) {
        const b = bundleRef.current;
        const c = parseConfig(b?.booking?.planner_book_config);
        try {
          await publishBooking(token, secret, c, computeBusy(b ?? null, c.horizonDays));
          const d2 = await pullBookings(token, secret);
          setData(d2);
          bkCache[token] = d2;
          if (onMutate) onMutate((b2) => reconcileBookings(b2, d2.bookings));
          finalBookings = d2.bookings;
        } catch {}
      }
      // Keep the public page's busy in sync: include active bookings so a slot that's
      // already requested/accepted is blocked for other guests (best-effort hold).
      try {
        const bun = bundleRef.current;
        const c = parseConfig(bun?.booking?.planner_book_config);
        const busy = computeBusy(bun ?? null, c.horizonDays);
        for (const bk of finalBookings) {
          if (bk.status !== 'pending' && bk.status !== 'accepted' && bk.status !== 'reschedule_proposed')
            continue;
          const s = timeToMin(bk.time);
          const du = bk.duration || 30;
          (busy[bk.date] = busy[bk.date] || []).push([s, s + du]);
        }
        await publishBooking(token, secret, c, busy);
      } catch {}
    } catch (e: any) {
      setError(e?.message ?? 'Could not load bookings.');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [token, secret, onMutate]);

  useEffect(() => {
    load();
  }, [load]);

  const onAction = useCallback(
    async (action: string, id: string, extra?: Record<string, any>) => {
      if (!token || !secret) return;
      try {
        // accept/reschedule must carry the owner's timezone so the worker times the
        // Google Meet link correctly (otherwise the time is treated as UTC).
        const withTz =
          action === 'accept' || action === 'reschedule'
            ? { tz: deviceTz(), ...(extra || {}) }
            : extra;
        const res = await manageBooking(token, secret, action, id, withTz);
        if (res.clash) {
          Alert.alert(
            'Time unavailable',
            'That time overlaps another booking. Please pick a different time.',
          );
          return;
        }
        if (res.bookings) {
          const bks = res.bookings;
          setData((d) => (d ? { ...d, bookings: bks } : d));
          if (token) bkCache[token] = { ...(bkCache[token] as OwnerData), bookings: bks };
          if (onMutate) onMutate((b) => reconcileBookings(b, bks));
          const who = bks.find((x) => x.id === id)?.name || 'guest';
          if (action === 'accept') LiveActivity.toast('Booking confirmed · ' + who, 'success');
          else if (action === 'decline') LiveActivity.toast('Booking declined · ' + who, 'error');
          else if (action === 'reschedule') LiveActivity.toast('New time sent · ' + who, 'info');
        } else load();
      } catch {
        load();
      }
    },
    [token, secret, load, onMutate],
  );

  const enableBookings = useCallback(async () => {
    if (!onMutate) return;
    setBusyMsg('Creating your booking link…');
    const newTok = token || randId(11);
    const newSec = secret || randId(24);
    const baseCfg = parseConfig(bundle?.booking?.planner_book_config);
    onMutate((b) => {
      if (!b.booking) b.booking = {};
      if (!b.booking.planner_book_token) b.booking.planner_book_token = newTok;
      if (!b.booking.planner_book_secret) b.booking.planner_book_secret = newSec;
      if (!b.booking.planner_book_config) b.booking.planner_book_config = JSON.stringify(baseCfg);
      b.booking.planner_book_enabled = '1';
    });
    try {
      await publishBooking(newTok, newSec, baseCfg, computeBusy(bundle ?? null, baseCfg.horizonDays));
    } catch {}
    setTimeout(() => {
      setBusyMsg(null);
      load();
    }, 800);
  }, [onMutate, token, secret, bundle, load]);

  const saveConfig = useCallback(
    async (next: BookConfig) => {
      if (onMutate)
        onMutate((b) => {
          if (!b.booking) b.booking = {};
          b.booking.planner_book_config = JSON.stringify(next);
        });
      setCfgOpen(false);
      if (token && secret) {
        setBusyMsg('Publishing availability…');
        try {
          await publishBooking(token, secret, next, computeBusy(bundle ?? null, next.horizonDays));
        } catch {}
        setTimeout(() => setBusyMsg(null), 700);
      }
    },
    [onMutate, token, secret, bundle],
  );

  if (!token || !secret) {
    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.setupCard}>
          <SymbolView
            name="calendar.badge.plus"
            size={34}
            tintColor={C.brass}
            fallback={<Text style={{ color: C.brass, fontSize: 30 }}>📅</Text>}
          />
          <Text style={styles.setupTitle}>Let people book your time</Text>
          <Text style={styles.setupSub}>
            Create a private link guests can open to pick an open slot. They only ever see times
            you’re free — your tasks stay hidden.
          </Text>
          <View style={styles.setupBullets}>
            <SetupRow icon="clock" text="You choose the days, hours & meeting length" />
            <SetupRow icon="checkmark.shield" text="Requests come here to accept or decline" />
            <SetupRow icon="video" text="Optional Google Meet links on accept" />
          </View>
          <Pressable
            style={({ pressed }) => [styles.enableBtn, pressed && { opacity: 0.85 }]}
            disabled={!!busyMsg || !onMutate}
            onPress={enableBookings}>
            <Text style={styles.enableBtnText}>{busyMsg ?? 'Enable booking link'}</Text>
          </Pressable>
        </View>
        <View style={{ height: 60 }} />
      </ScrollView>
    );
  }

  if (loading) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator color={C.brass} />
      </View>
    );
  }

  // bookings the owner deleted from the timeline are dismissed (synced) — hide them everywhere
  // on this page too: requests / upcoming / history lists AND the calendar.
  let _dismissed: Set<string>;
  try {
    _dismissed = new Set<string>(JSON.parse((bundle?.booking?.planner_book_dismissed as string) || '[]'));
  } catch {
    _dismissed = new Set<string>();
  }
  const bookings = (data?.bookings ?? []).filter((b) => !_dismissed.has(b.id));
  const dt = (b: Booking) => {
    try {
      return new Date(b.date + 'T' + (b.time || '00:00')).getTime();
    } catch {
      return 0;
    }
  };
  const nowMs = Date.now();
  const dayFilter = (b: Booking) => !selectedDay || b.date === selectedDay;
  const requests = bookings
    .filter((b) => (b.status === 'pending' || b.status === 'reschedule_proposed') && dayFilter(b))
    .sort((a, b) => dt(a) - dt(b));
  const upcoming = bookings
    .filter((b) => b.status === 'accepted' && dt(b) >= nowMs - 3600000 && dayFilter(b))
    .sort((a, b) => dt(a) - dt(b));
  const history = bookings
    .filter(
      (b) =>
        b.status !== 'pending' &&
        b.status !== 'reschedule_proposed' &&
        !(b.status === 'accepted' && dt(b) >= nowMs - 3600000) &&
        dayFilter(b),
    )
    .sort((a, b) => dt(b) - dt(a));

  const link = publicLink(token);
  const detailLive = detail ? bookings.find((x) => x.id === detail.id) ?? detail : null;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: bottomInset }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.brass} />}>
      {/* Toolbar: share · meet · availability (3 icons with popups) */}
      <View style={styles.toolbar}>
        <Text style={styles.toolbarTitle}>Bookings</Text>
        <View style={styles.toolbarIcons}>
          <Pressable style={styles.toolBtn} onPress={() => setShareOpen(true)} hitSlop={6}>
            <SymbolView name="link" size={17} tintColor={C.ink} fallback={<Text style={{ color: C.ink }}>🔗</Text>} />
          </Pressable>
          <Pressable style={styles.toolBtn} onPress={() => setMeetOpen(true)} hitSlop={6}>
            <SymbolView name="video.fill" size={17} tintColor={C.ink} fallback={<Text style={{ color: C.ink }}>▶</Text>} />
            <View
              style={[
                styles.toolDot,
                { backgroundColor: data?.googleConnected ? C.green : C.inkFaint },
              ]}
            />
          </Pressable>
          <Pressable style={styles.toolBtn} onPress={() => setCfgOpen(true)} hitSlop={6}>
            <SymbolView name="slider.horizontal.3" size={17} tintColor={C.ink} fallback={<Text style={{ color: C.ink }}>⚙</Text>} />
          </Pressable>
        </View>
      </View>

      {!!busyMsg && <Text style={styles.busyMsg}>{busyMsg}</Text>}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {selectedDay && (
        <Pressable style={styles.filterChip} onPress={() => setSelectedDay(null)}>
          <Text style={styles.filterChipText}>Showing {fmtDate(selectedDay)}</Text>
          <SymbolView name="xmark" size={11} tintColor={C.brass} fallback={<Text style={{ color: C.brass }}>×</Text>} />
        </Pressable>
      )}

      <Text style={styles.section}>REQUESTS{requests.length ? ` · ${requests.length}` : ''}</Text>
      {requests.length === 0 ? (
        <Text style={styles.noneText}>No pending requests.</Text>
      ) : (
        requests.map((b) => <BookingCard key={b.id} b={b} onAction={onAction} onOpen={setDetail} />)
      )}

      <Text style={[styles.section, { marginTop: 22 }]}>
        UPCOMING{upcoming.length ? ` · ${upcoming.length}` : ''}
      </Text>
      {upcoming.length === 0 ? (
        <Text style={styles.noneText}>No confirmed bookings.</Text>
      ) : (
        upcoming.map((b) => <BookingCard key={b.id} b={b} onAction={onAction} onOpen={setDetail} />)
      )}

      <Pressable style={[styles.section, styles.sectionToggle, { marginTop: 22 }]} onPress={() => setHistOpen((v) => !v)}>
        <Text style={styles.sectionToggleText}>HISTORY{history.length ? ` · ${history.length}` : ''}</Text>
        <SymbolView name={histOpen ? 'chevron.up' : 'chevron.down'} size={12} tintColor={C.inkDim} fallback={<Text style={{ color: C.inkDim }}>{histOpen ? '▲' : '▼'}</Text>} />
      </Pressable>
      {histOpen &&
        (history.length === 0 ? (
          <Text style={styles.noneText}>Nothing yet.</Text>
        ) : (
          history.map((b) => <BookingCard key={b.id} b={b} onAction={onAction} onOpen={setDetail} />)
        ))}

      <Text style={[styles.section, { marginTop: 26 }]}>CALENDAR</Text>
      <BookingCalendar
        bookings={bookings}
        selectedDay={selectedDay}
        onPickDay={setSelectedDay}
        onOpenBooking={setDetail}
      />
      {cfgOpen && (
        <BookingConfigModal initial={cfg} onClose={() => setCfgOpen(false)} onSave={saveConfig} />
      )}
      {shareOpen && (
        <ShareModal link={link} onClose={() => setShareOpen(false)} />
      )}
      {meetOpen && (
        <MeetModal
          connected={!!data?.googleConnected}
          onClose={() => setMeetOpen(false)}
          onConnect={async () => {
            setMeetOpen(false);
            try {
              await WebBrowser.openBrowserAsync(gauthStartLink(token, secret));
            } catch {}
            setBusyMsg('Checking Google connection…');
            setTimeout(() => {
              setBusyMsg(null);
              load();
            }, 900);
          }}
        />
      )}
      {detailLive && (
        <BookingDetail booking={detailLive} onClose={() => setDetail(null)} onAction={onAction} />
      )}
    </ScrollView>
  );
}

function ShareModal({ link, onClose }: { link: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const pretty = link.replace(/^https?:\/\//, '');
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };
  const share = () => {
    // iOS doubles the link if both message + url are passed — pass one only.
    Share.share(Platform.OS === 'ios' ? { url: link } : { message: link }).catch(() => {});
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.shareHeader}>
            <View style={styles.shareIcon}>
              <SymbolView name="link" size={20} tintColor={C.brass} fallback={<Text style={{ color: C.brass }}>🔗</Text>} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.dName}>Your booking link</Text>
              <Text style={styles.shareSub}>Never changes · guests only see open slots</Text>
            </View>
          </View>

          <Text style={styles.shareLabel}>SHAREABLE LINK</Text>
          <Pressable style={styles.linkBox} onPress={copy}>
            <Text style={styles.linkBoxText} numberOfLines={2}>
              {pretty}
            </Text>
            <View style={[styles.copyPill, copied && styles.copyPillOn]}>
              <SymbolView
                name={copied ? 'checkmark' : 'doc.on.doc'}
                size={13}
                tintColor={copied ? C.bg : C.brass}
                fallback={<Text style={{ color: copied ? C.bg : C.brass }}>{copied ? '✓' : '⧉'}</Text>}
              />
              <Text style={[styles.copyPillText, copied && { color: C.bg }]}>
                {copied ? 'Copied' : 'Copy'}
              </Text>
            </View>
          </Pressable>

          <View style={styles.shareActions}>
            <Pressable style={styles.shareBig} onPress={share}>
              <SymbolView name="square.and.arrow.up" size={18} tintColor={C.bg} fallback={<Text style={{ color: C.bg }}>↑</Text>} />
              <Text style={styles.shareBigText}>Share</Text>
            </Pressable>
            <Pressable style={styles.shareGhostBig} onPress={() => WebBrowser.openBrowserAsync(link)}>
              <SymbolView name="safari" size={18} tintColor={C.ink} fallback={<Text style={{ color: C.ink }}>◎</Text>} />
              <Text style={styles.shareGhostBigText}>Preview</Text>
            </Pressable>
          </View>

          <Pressable style={styles.dGhost} onPress={onClose}>
            <Text style={styles.dGhostText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function MeetModal({
  connected,
  onClose,
  onConnect,
}: {
  connected: boolean;
  onClose: () => void;
  onConnect: () => void;
}) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.dName}>Google Meet</Text>
          <View style={styles.meetStatusRow}>
            <View style={[styles.meetDot, { backgroundColor: connected ? C.green : C.inkFaint }]} />
            <Text style={styles.meetStatus}>
              {connected ? 'Connected — accepted bookings get a Meet link' : 'Not connected'}
            </Text>
          </View>
          <Text style={styles.dWhen}>
            Connect your Google account to automatically add a Google Meet link to every booking you
            accept.
          </Text>
          <Pressable style={styles.dPrimary} onPress={onConnect}>
            <Text style={styles.dPrimaryText}>
              {connected ? 'Reconnect Google account' : 'Connect Google account'}
            </Text>
          </Pressable>
          <Pressable style={styles.dGhost} onPress={onClose}>
            <Text style={styles.dGhostText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function DBtn({ label, color, onPress }: { label: string; color?: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.dBtn, color ? { borderColor: color + '66' } : null]} onPress={onPress}>
      <Text style={[styles.dBtnText, color ? { color } : null]}>{label}</Text>
    </Pressable>
  );
}

const OUTCOMES: [string, string][] = [
  ['completed', 'Completed'],
  ['no_show', 'No-show'],
  ['missed', 'Missed'],
  ['not_held', 'Not held'],
];

function BookingDetail({
  booking,
  onClose,
  onAction,
}: {
  booking: Booking;
  onClose: () => void;
  onAction: (action: string, id: string, extra?: Record<string, any>) => void;
}) {
  const [reschedOpen, setReschedOpen] = useState(false);
  const [when, setWhen] = useState(() => new Date());
  useEffect(() => {
    setReschedOpen(false);
    try {
      const src = booking.status === 'reschedule_proposed' && booking.proposed ? booking.proposed : booking;
      setWhen(new Date(src.date + 'T' + src.time));
    } catch {
      setWhen(new Date());
    }
  }, [booking.id]);
  const st = booking.status;
  const meta = statusMeta(st);
  const isNew = st === 'pending';
  const isProposed = st === 'reschedule_proposed';
  const isAccepted = st === 'accepted';
  const canManage = isNew || isProposed || isAccepted;
  const pad = (n: number) => String(n).padStart(2, '0');
  const doResched = () => {
    onAction('reschedule', booking.id, {
      date: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`,
      time: `${pad(when.getHours())}:${pad(when.getMinutes())}`,
      duration: booking.duration,
    });
    onClose();
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.handle} />
            <Text style={styles.dName}>{booking.name || 'Guest'}</Text>
            <Text style={styles.dWhen}>
              {fmtDate(booking.date)} · {fmtTime(booking.time)}
              {booking.duration ? ` · ${booking.duration}m` : ''}
            </Text>
            <View style={[styles.badge, { backgroundColor: meta.color + '22', alignSelf: 'flex-start', marginTop: 10 }]}>
              <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
            </View>
            {isProposed && booking.proposed && (
              <View style={styles.proposedBox}>
                <Text style={styles.proposedLabel}>NEW TIME SENT — AWAITING GUEST</Text>
                <Text style={styles.proposedWhen}>
                  {fmtDate(booking.proposed.date)} · {fmtTime(booking.proposed.time)}
                  {booking.proposed.duration ? ` · ${booking.proposed.duration}m` : ''}
                </Text>
                <Text style={styles.proposedFrom}>was {fmtDate(booking.date)} · {fmtTime(booking.time)}</Text>
              </View>
            )}
            {!!booking.email && <Text style={styles.dMeta}>{booking.email}</Text>}
            {!!booking.note && <Text style={styles.dNote}>“{booking.note}”</Text>}
            {!!booking.meetLink && (
              <Pressable style={styles.meetBtn} onPress={() => Linking.openURL(booking.meetLink!)}>
                <SymbolView name="video.fill" size={14} tintColor={C.blue} fallback={<Text>▶</Text>} />
                <Text style={styles.meetBtnText}>Join Google Meet</Text>
              </Pressable>
            )}

            {reschedOpen ? (
              <>
                <Text style={styles.dLabel}>NEW DATE & TIME</Text>
                <View style={styles.dPicker}>
                  <DateTimePicker
                    value={when}
                    mode="datetime"
                    display="spinner"
                    themeVariant="dark"
                    onChange={(_, d) => d && setWhen(d)}
                    style={{ height: 170 }}
                  />
                </View>
                <Pressable style={styles.dPrimary} onPress={doResched}>
                  <Text style={styles.dPrimaryText}>Send new time</Text>
                </Pressable>
                <Pressable style={styles.dGhost} onPress={() => setReschedOpen(false)}>
                  <Text style={styles.dGhostText}>Back</Text>
                </Pressable>
              </>
            ) : (
              <View style={{ gap: 9, marginTop: 18 }}>
                {isNew && (
                  <DBtn label="Accept" color={C.green} onPress={() => { onAction('accept', booking.id); onClose(); }} />
                )}
                {isNew && (
                  <DBtn label="Decline" onPress={() => { onAction('decline', booking.id); onClose(); }} />
                )}
                {isAccepted && (
                  <>
                    <Text style={styles.dLabel}>LOG OUTCOME</Text>
                    <View style={styles.outcomeRow}>
                      {OUTCOMES.map(([k, l]) => (
                        <Pressable
                          key={k}
                          style={styles.outcomeBtn}
                          onPress={() => { onAction('outcome', booking.id, { outcome: k }); onClose(); }}>
                          <Text style={styles.outcomeText}>{l}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                )}
                {canManage && <DBtn label={isProposed ? 'Change proposed time…' : 'Reschedule…'} onPress={() => setReschedOpen(true)} />}
                {canManage && (
                  <DBtn label="Cancel booking" color={C.red} onPress={() => { onAction('cancel', booking.id); onClose(); }} />
                )}
                <Pressable style={styles.dGhost} onPress={onClose}>
                  <Text style={styles.dGhostText}>Close</Text>
                </Pressable>
              </View>
            )}
            <View style={{ height: 30 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function minToDate(m: number): Date {
  const d = new Date();
  d.setHours(Math.floor(m / 60), m % 60, 0, 0);
  return d;
}

function BookingConfigModal({
  initial,
  onClose,
  onSave,
}: {
  initial: BookConfig;
  onClose: () => void;
  onSave: (c: BookConfig) => void;
}) {
  const [owner, setOwner] = useState(initial.owner ?? '');
  const [durationMin, setDurationMin] = useState(initial.durationMin);
  const [days, setDays] = useState<number[]>(initial.days);
  const [windows, setWindows] = useState<[number, number][]>(
    initial.windows && initial.windows.length
      ? initial.windows.map((w) => [w[0], w[1]] as [number, number])
      : [[initial.startMin, initial.endMin]],
  );
  const [slotMin, setSlotMin] = useState(initial.slotMin);
  const [horizonDays, setHorizonDays] = useState(initial.horizonDays);
  const [picker, setPicker] = useState<{ i: number; which: 'from' | 'to' } | null>(null);

  const setWin = (i: number, which: 0 | 1, min: number) =>
    setWindows((ws) =>
      ws.map((w, idx) =>
        idx === i ? (which === 0 ? [min, w[1]] : [w[0], min]) : w,
      ) as [number, number][],
    );
  const addWindow = () =>
    setWindows((ws) => {
      const lastEnd = ws.length ? ws[ws.length - 1][1] : 1020;
      let f = Math.min(lastEnd + 60, 22 * 60);
      let t = Math.min(f + 120, 23 * 60 + 59);
      if (t <= f) {
        f = 17 * 60;
        t = 19 * 60;
      }
      return [...ws, [f, t] as [number, number]];
    });
  const removeWindow = (i: number) =>
    setWindows((ws) => (ws.length > 1 ? ws.filter((_, idx) => idx !== i) : ws));

  const save = () => {
    const clean = windows
      .map((w) => [w[0], w[1] <= w[0] ? Math.min(w[0] + 60, 1439) : w[1]] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    onSave({
      owner: owner.trim(),
      durationMin,
      days: days.slice().sort((a, b) => a - b),
      startMin: clean[0][0],
      endMin: clean[clean.length - 1][1],
      windows: clean,
      slotMin,
      horizonDays,
    });
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.handle} />
            <Text style={styles.dName}>Availability</Text>
            <Text style={styles.dWhen}>Guests can only book inside these limits.</Text>

            <Text style={styles.cLabel}>YOUR NAME</Text>
            <TextInput
              value={owner}
              onChangeText={setOwner}
              placeholder="Shown to guests"
              placeholderTextColor={C.inkFaint}
              style={styles.cInput}
            />

            <Text style={styles.cLabel}>MEETING LENGTH</Text>
            <View style={styles.chipRow}>
              {[15, 30, 45, 60, 90, 120].map((d) => (
                <Pressable
                  key={d}
                  onPress={() => setDurationMin(d)}
                  style={[styles.cChip, durationMin === d && styles.cChipOn]}>
                  <Text style={[styles.cChipText, durationMin === d && styles.cChipTextOn]}>
                    {d < 60 ? `${d}m` : d % 60 === 0 ? `${d / 60}h` : `${Math.floor(d / 60)}h${d % 60}`}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.cLabel}>AVAILABLE DAYS</Text>
            <View style={styles.weekRow}>
              {WD.map((d, i) => {
                const on = days.includes(i);
                return (
                  <Pressable
                    key={i}
                    onPress={() => setDays((s) => (on ? s.filter((x) => x !== i) : [...s, i]))}
                    style={[styles.dayBtn, on && styles.dayBtnOn]}>
                    <Text style={[styles.dayBtnText, on && styles.dayBtnTextOn]}>{d}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.cLabel}>AVAILABLE HOURS</Text>
            <Text style={styles.cSub}>
              Add more windows for split availability — e.g. 9–11am and 5–7pm.
            </Text>
            {windows.map((w, i) => (
              <View key={i}>
                <View style={styles.winRow}>
                  <Pressable
                    style={styles.winBtn}
                    onPress={() =>
                      setPicker((p) => (p && p.i === i && p.which === 'from' ? null : { i, which: 'from' }))
                    }>
                    <Text style={styles.hourBtnLabel}>From</Text>
                    <Text style={styles.hourBtnVal}>{minToLabel(w[0])}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.winBtn}
                    onPress={() =>
                      setPicker((p) => (p && p.i === i && p.which === 'to' ? null : { i, which: 'to' }))
                    }>
                    <Text style={styles.hourBtnLabel}>To</Text>
                    <Text style={styles.hourBtnVal}>{minToLabel(w[1])}</Text>
                  </Pressable>
                  {windows.length > 1 && (
                    <Pressable style={styles.winRm} onPress={() => removeWindow(i)} hitSlop={6}>
                      <SymbolView name="xmark" size={13} tintColor={C.red} fallback={<Text style={{ color: C.red }}>×</Text>} />
                    </Pressable>
                  )}
                </View>
                {picker && picker.i === i && (
                  <View style={styles.cPicker}>
                    <DateTimePicker
                      value={minToDate(picker.which === 'from' ? w[0] : w[1])}
                      mode="time"
                      display="spinner"
                      themeVariant="dark"
                      minuteInterval={5}
                      onChange={(_, d) => {
                        if (d) setWin(i, picker.which === 'from' ? 0 : 1, d.getHours() * 60 + d.getMinutes());
                      }}
                      style={{ height: 150 }}
                    />
                  </View>
                )}
              </View>
            ))}
            <Pressable style={styles.addWinBtn} onPress={addWindow}>
              <SymbolView name="plus" size={13} tintColor={C.brass} fallback={<Text style={{ color: C.brass }}>+</Text>} />
              <Text style={styles.addWinText}>Add another window</Text>
            </Pressable>

            <Text style={styles.cLabel}>SLOT INTERVAL</Text>
            <View style={styles.chipRow}>
              {[10, 15, 20, 30, 45, 60].map((d) => (
                <Pressable
                  key={d}
                  onPress={() => setSlotMin(d)}
                  style={[styles.cChip, slotMin === d && styles.cChipOn]}>
                  <Text style={[styles.cChipText, slotMin === d && styles.cChipTextOn]}>{d}m</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.cLabel}>BOOKABLE WINDOW</Text>
            <View style={styles.stepper}>
              <Pressable style={styles.stepBtn} onPress={() => setHorizonDays((h) => Math.max(1, h - 7))}>
                <Text style={styles.stepSign}>−</Text>
              </Pressable>
              <Text style={styles.stepVal}>Next {horizonDays} days</Text>
              <Pressable style={styles.stepBtn} onPress={() => setHorizonDays((h) => Math.min(90, h + 7))}>
                <Text style={styles.stepSign}>+</Text>
              </Pressable>
            </View>

            <Pressable style={styles.dPrimary} onPress={save}>
              <Text style={styles.dPrimaryText}>Save & publish</Text>
            </Pressable>
            <Pressable style={styles.dGhost} onPress={onClose}>
              <Text style={styles.dGhostText}>Cancel</Text>
            </Pressable>
            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: 10, paddingVertical: 70 },
  emptyTitle: { fontFamily: F.semibold, color: C.ink, fontSize: 17 },
  emptySub: { fontFamily: F.regular, color: C.inkFaint, fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },

  setupCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 18, padding: 22, alignItems: 'center', marginTop: 8 },
  setupTitle: { fontFamily: F.semibold, color: C.ink, fontSize: 19, marginTop: 14, textAlign: 'center' },
  setupSub: { fontFamily: F.regular, color: C.inkDim, fontSize: 13.5, textAlign: 'center', lineHeight: 20, marginTop: 8 },
  setupBullets: { alignSelf: 'stretch', gap: 11, marginTop: 18, marginBottom: 22 },
  setupRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  setupRowText: { flex: 1, fontFamily: F.medium, color: C.inkDim, fontSize: 13 },
  enableBtn: { alignSelf: 'stretch', backgroundColor: C.brass, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  enableBtnText: { fontFamily: F.bold, color: C.bg, fontSize: 15.5 },

  cfgCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 15, marginBottom: 22 },
  cfgLabel: { fontFamily: F.bold, color: C.inkFaint, fontSize: 10, letterSpacing: 1.4, marginBottom: 5 },
  cfgSummary: { fontFamily: F.semibold, color: C.ink, fontSize: 14.5 },
  cfgSub: { fontFamily: F.regular, color: C.inkDim, fontSize: 12, marginTop: 3 },
  busyMsg: { fontFamily: F.medium, color: C.brass, fontSize: 12.5, marginBottom: 12 },

  calCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 14, marginBottom: 18 },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  calTitle: { fontFamily: F.semibold, color: C.ink, fontSize: 15 },
  calNav: { minWidth: 30, height: 30, paddingHorizontal: 8, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSoft },
  calTodayBtn: { fontFamily: F.semibold, color: C.brass, fontSize: 12 },

  weekStrip: { flexDirection: 'row', marginBottom: 6 },
  weekDay: { flex: 1, alignItems: 'center', gap: 5, paddingVertical: 4 },
  weekDow: { fontFamily: F.bold, color: C.inkFaint, fontSize: 10, letterSpacing: 0.5 },
  weekNumWrap: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  weekNumToday: { borderWidth: 1, borderColor: C.brass },
  weekNumSel: { backgroundColor: C.brass, borderWidth: 0 },
  weekNum: { fontFamily: F.medium, color: C.ink, fontSize: 13 },
  weekDot: { width: 4, height: 4, borderRadius: 2 },

  schedule: { position: 'relative', marginTop: 10 },
  schedHourRow: { position: 'absolute', left: 0, right: 0, height: 1, flexDirection: 'row', alignItems: 'center' },
  schedHourLabel: { width: 42, fontFamily: F.regular, color: C.inkFaint, fontSize: 9.5, marginTop: -6 },
  schedHourLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.05)' },
  schedBlock: { position: 'absolute', left: 48, right: 4, borderRadius: 8, borderLeftWidth: 3, paddingHorizontal: 9, paddingVertical: 5, justifyContent: 'center', overflow: 'hidden' },
  schedBlockText: { fontFamily: F.semibold, fontSize: 12.5 },
  schedBlockSub: { fontFamily: F.regular, color: C.inkDim, fontSize: 10.5, marginTop: 1 },
  schedBlockCancelled: { borderLeftWidth: 0, borderWidth: 1, borderStyle: 'dashed', borderColor: C.red + '66', opacity: 0.7 },
  schedStrike: { textDecorationLine: 'line-through' },
  schedEmpty: { fontFamily: F.regular, color: C.inkFaint, fontSize: 12.5, textAlign: 'center', marginTop: 14 },
  nowLine: { position: 'absolute', left: 42, right: 0, height: 2, flexDirection: 'row', alignItems: 'center' },
  nowDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.red, marginLeft: -4 },
  nowBar: { flex: 1, height: 1.5, backgroundColor: C.red },

  filterChip: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 7, backgroundColor: 'rgba(201,151,74,0.16)', borderWidth: 1, borderColor: C.brass, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7, marginBottom: 16 },
  filterChipText: { fontFamily: F.semibold, color: C.brass, fontSize: 12.5 },

  cLabel: { fontFamily: F.bold, color: C.inkFaint, fontSize: 10.5, letterSpacing: 1.3, marginTop: 18, marginBottom: 9 },
  cInput: { fontFamily: F.medium, color: C.ink, fontSize: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: C.card },
  cChipOn: { backgroundColor: 'rgba(201,151,74,0.16)', borderColor: C.brass },
  cChipText: { fontFamily: F.semibold, color: C.inkDim, fontSize: 13.5 },
  cChipTextOn: { color: C.brass },
  weekRow: { flexDirection: 'row', gap: 7 },
  dayBtn: { flex: 1, aspectRatio: 1, maxWidth: 46, borderRadius: 999, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  dayBtnOn: { backgroundColor: C.brass, borderColor: C.brass },
  dayBtnText: { fontFamily: F.bold, color: C.inkDim, fontSize: 13 },
  dayBtnTextOn: { color: C.bg },
  hoursRow: { flexDirection: 'row', gap: 10 },
  hourBtn: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  hourBtnLabel: { fontFamily: F.regular, color: C.inkFaint, fontSize: 11 },
  hourBtnVal: { fontFamily: F.semibold, color: C.ink, fontSize: 16, marginTop: 3 },
  cSub: { fontFamily: F.regular, color: C.inkDim, fontSize: 12, marginTop: -3, marginBottom: 10, lineHeight: 17 },
  winRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  winBtn: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  winRm: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(201,122,106,0.12)' },
  addWinBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingVertical: 8, marginBottom: 4 },
  addWinText: { fontFamily: F.semibold, color: C.brass, fontSize: 13 },
  cPicker: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.line, overflow: 'hidden', marginTop: 10 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 8 },
  stepBtn: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSoft },
  stepSign: { fontFamily: F.bold, color: C.brass, fontSize: 20 },
  stepVal: { fontFamily: F.semibold, color: C.ink, fontSize: 15 },

  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  toolbarTitle: { fontFamily: F.semibold, color: C.ink, fontSize: 22 },
  toolbarIcons: { flexDirection: 'row', gap: 10 },
  toolBtn: { width: 42, height: 42, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  toolDot: { position: 'absolute', top: 8, right: 8, width: 7, height: 7, borderRadius: 4, borderWidth: 1.5, borderColor: C.card },
  linkBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingLeft: 14, paddingRight: 8, paddingVertical: 10, marginBottom: 16 },
  linkBoxText: { flex: 1, fontFamily: F.medium, color: C.ink, fontSize: 13 },
  shareHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  shareIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(201,151,74,0.16)', alignItems: 'center', justifyContent: 'center' },
  shareSub: { fontFamily: F.regular, color: C.inkDim, fontSize: 12.5, marginTop: 3 },
  shareLabel: { fontFamily: F.bold, color: C.inkFaint, fontSize: 10.5, letterSpacing: 1.3, marginBottom: 9 },
  copyPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 9, backgroundColor: 'rgba(201,151,74,0.16)', borderWidth: 1, borderColor: C.brass },
  copyPillOn: { backgroundColor: C.brass, borderColor: C.brass },
  copyPillText: { fontFamily: F.semibold, color: C.brass, fontSize: 12.5 },
  shareActions: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  shareBig: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.brass, borderRadius: 14, paddingVertical: 14 },
  shareBigText: { fontFamily: F.bold, color: C.bg, fontSize: 15 },
  shareGhostBig: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingVertical: 14 },
  shareGhostBigText: { fontFamily: F.semibold, color: C.ink, fontSize: 15 },
  meetStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, marginBottom: 6 },
  linkCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 16, marginBottom: 22 },
  linkTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  linkLabel: { fontFamily: F.bold, color: C.inkFaint, fontSize: 10, letterSpacing: 1.4, marginBottom: 5 },
  linkUrl: { fontFamily: F.medium, color: C.ink, fontSize: 14 },
  shareBtn: { width: 42, height: 42, borderRadius: 12, backgroundColor: C.brass, alignItems: 'center', justifyContent: 'center' },
  meetRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  meetDot: { width: 8, height: 8, borderRadius: 4 },
  meetStatus: { fontFamily: F.medium, color: C.inkDim, fontSize: 12.5 },

  section: { fontFamily: F.bold, color: C.inkFaint, fontSize: 11, letterSpacing: 1.6, marginBottom: 12 },
  sectionToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionToggleText: { fontFamily: F.bold, color: C.inkFaint, fontSize: 11, letterSpacing: 1.6 },
  noneText: { fontFamily: F.regular, color: C.inkFaint, fontSize: 13, marginBottom: 6 },
  errorText: { fontFamily: F.regular, color: C.red, fontSize: 13, marginBottom: 12 },

  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 15, marginBottom: 11 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardName: { fontFamily: F.semibold, color: C.ink, fontSize: 15 },
  cardWhen: { fontFamily: F.regular, color: C.inkDim, fontSize: 12.5, marginTop: 2 },
  cardWhenStrike: { textDecorationLine: 'line-through', color: C.inkFaint },
  awaitRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 10, backgroundColor: C.amber + '14', borderWidth: 1, borderColor: C.amber + '33' },
  awaitText: { flex: 1, fontFamily: F.medium, color: C.amber, fontSize: 12 },
  proposedBox: { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.amber + '40', backgroundColor: C.amber + '12' },
  proposedLabel: { fontFamily: F.bold, color: C.amber, fontSize: 9.5, letterSpacing: 1 },
  proposedWhen: { fontFamily: F.semibold, color: C.ink, fontSize: 15, marginTop: 5 },
  proposedFrom: { fontFamily: F.regular, color: C.inkFaint, fontSize: 11.5, marginTop: 3, textDecorationLine: 'line-through' },
  badge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontFamily: F.bold, fontSize: 10, letterSpacing: 0.3 },
  cardNote: { fontFamily: F.regular, color: C.inkDim, fontSize: 13, marginTop: 10, fontStyle: 'italic' },
  cardEmail: { fontFamily: F.regular, color: C.inkFaint, fontSize: 12, marginTop: 6 },
  meetBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12, alignSelf: 'flex-start', borderWidth: 1, borderColor: 'rgba(127,168,201,0.4)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  meetBtnText: { fontFamily: F.semibold, color: C.blue, fontSize: 13 },
  cardActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actBtn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 11 },
  actAccept: { backgroundColor: C.green },
  actAcceptText: { fontFamily: F.bold, color: C.bg, fontSize: 14 },
  actDecline: { borderWidth: 1, borderColor: C.line },
  actDeclineText: { fontFamily: F.semibold, color: C.inkDim, fontSize: 14 },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.bgSoft,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: C.line,
    padding: 22,
    paddingBottom: 36,
    maxHeight: '90%',
  },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: C.line, marginBottom: 16 },
  dName: { fontFamily: F.semibold, color: C.ink, fontSize: 19 },
  dWhen: { fontFamily: F.regular, color: C.inkDim, fontSize: 13.5, marginTop: 4 },
  dMeta: { fontFamily: F.regular, color: C.inkFaint, fontSize: 13, marginTop: 12 },
  dNote: { fontFamily: F.regular, color: C.inkDim, fontSize: 14, fontStyle: 'italic', marginTop: 10, lineHeight: 20 },
  dLabel: { fontFamily: F.bold, color: C.inkFaint, fontSize: 10.5, letterSpacing: 1.3, marginTop: 18, marginBottom: 9 },
  dPicker: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  dPrimary: { backgroundColor: C.brass, borderRadius: 13, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  dPrimaryText: { fontFamily: F.bold, color: C.bg, fontSize: 15 },
  dGhost: { alignItems: 'center', paddingVertical: 13, marginTop: 4 },
  dGhostText: { fontFamily: F.medium, color: C.inkDim, fontSize: 14 },
  dBtn: { borderWidth: 1, borderColor: C.line, borderRadius: 13, paddingVertical: 14, alignItems: 'center' },
  dBtnText: { fontFamily: F.semibold, color: C.ink, fontSize: 15 },
  outcomeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  outcomeBtn: { flexGrow: 1, flexBasis: '46%', borderWidth: 1, borderColor: C.line, borderRadius: 11, paddingVertical: 12, alignItems: 'center', backgroundColor: C.card },
  outcomeText: { fontFamily: F.semibold, color: C.ink, fontSize: 13.5 },
});
