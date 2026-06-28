import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  LiveActivity,
  isLiveActivityModuleLinked,
  type LiveActivityTask,
} from '../../modules/live-activity';

function liquidGlassReady(): boolean {
  try {
    return isLiquidGlassAvailable();
  } catch {
    return false;
  }
}

const COLORS = {
  ink: '#15120C',
  card: '#1E1A12',
  cardLine: 'rgba(201,151,74,0.18)',
  brass: '#C9974A',
  brassSoft: 'rgba(201,151,74,0.16)',
  text: '#F4EEE2',
  textDim: 'rgba(244,238,226,0.6)',
  textFaint: 'rgba(244,238,226,0.4)',
  green: '#6B7B5A',
  red: '#E5484D',
};

type Preset = {
  key: string;
  label: string;
  symbol: string;
  accentHex: string;
  priority: LiveActivityTask['priority'];
  title: string;
  subtitle: string;
  minutes: number;
};

const PRESETS: Preset[] = [
  {
    key: 'meeting',
    label: 'Meeting',
    symbol: 'person.2.fill',
    accentHex: '#5B8DEF',
    priority: 'high',
    title: 'Design review',
    subtitle: 'with Priya · Google Meet',
    minutes: 45,
  },
  {
    key: 'focus',
    label: 'Deep work',
    symbol: 'bolt.fill',
    accentHex: '#C9974A',
    priority: 'must',
    title: 'Ship planner sync',
    subtitle: 'Focus block · no interruptions',
    minutes: 90,
  },
  {
    key: 'break',
    label: 'Break',
    symbol: 'cup.and.saucer.fill',
    accentHex: '#6B7B5A',
    priority: 'low',
    title: 'Lunch & walk',
    subtitle: 'Step away from the screen',
    minutes: 30,
  },
];

function fmtTime(epoch: number) {
  return new Date(epoch * 1000).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function PriorityPill({ priority }: { priority: LiveActivityTask['priority'] }) {
  const map: Record<string, { label: string; color: string }> = {
    must: { label: 'MUST', color: '#E5484D' },
    high: { label: 'HIGH', color: '#E0903C' },
    medium: { label: 'MED', color: '#C9974A' },
    low: { label: 'LOW', color: '#6B7B5A' },
  };
  const p = map[priority ?? 'medium'];
  return (
    <View style={[styles.pill, { backgroundColor: p.color + '28' }]}>
      <Text style={[styles.pillText, { color: p.color }]}>{p.label}</Text>
    </View>
  );
}

function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object;
}) {
  if (liquidGlassReady()) {
    return (
      <GlassView
        glassEffectStyle="regular"
        colorScheme="dark"
        style={[styles.card, style]}>
        {children}
      </GlassView>
    );
  }
  return <View style={[styles.card, styles.cardFallback, style]}>{children}</View>;
}

export default function LiveActivityScreen() {
  const [presetKey, setPresetKey] = useState(PRESETS[0].key);
  const [activityId, setActivityId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preset = useMemo(
    () => PRESETS.find((p) => p.key === presetKey) ?? PRESETS[0],
    [presetKey],
  );

  const now = Math.floor(Date.now() / 1000);
  const sample: LiveActivityTask = useMemo(
    () => ({
      taskId: preset.key,
      title: preset.title,
      subtitle: preset.subtitle,
      symbol: preset.symbol,
      accentHex: preset.accentHex,
      startEpoch: now,
      endEpoch: now + preset.minutes * 60,
      priority: preset.priority,
      isRunning: true,
    }),
    [preset, now],
  );

  const onStart = useCallback(async () => {
    setError(null);
    try {
      if (!isLiveActivityModuleLinked) {
        setError(
          'Preview only: the Live Activity needs the full native build (it cannot run in Expo Go).',
        );
        return;
      }
      if (!LiveActivity.isSupported()) {
        setError('Live Activities are off. Enable them in Settings → Day Planner.');
        return;
      }
      await LiveActivity.endAll();
      const id = await LiveActivity.start(sample);
      setActivityId(id);
    } catch (e: any) {
      setError(e?.message ?? 'Could not start the Live Activity.');
    }
  }, [sample]);

  const onEnd = useCallback(async () => {
    await LiveActivity.endAll();
    setActivityId(null);
  }, []);

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Live Activity',
          headerStyle: { backgroundColor: '#15120C' },
          headerTintColor: '#C9974A',
          headerTitleStyle: { color: '#F4EEE2' },
        }}
      />
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}>
          <Text style={styles.kicker}>DAY PLANNER</Text>
          <Text style={styles.h1}>Live on your Lock Screen</Text>
          <Text style={styles.lead}>
            Pin your current task to the Dynamic Island and Lock Screen with a
            self-counting timer — no notifications, no fuss.
          </Text>

          {/* Live Activity preview — mirrors the Dynamic Island lock screen */}
          <Card style={styles.preview}>
            <View style={styles.previewTop}>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: preset.accentHex + '2E', borderColor: preset.accentHex + '8C' },
                ]}>
                <SymbolView
                  name={preset.symbol as any}
                  size={18}
                  tintColor={preset.accentHex}
                  fallback={<Text style={{ color: preset.accentHex }}>●</Text>}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.taskTitle} numberOfLines={1}>
                  {preset.title}
                </Text>
                <Text style={styles.taskSub} numberOfLines={1}>
                  {preset.subtitle}
                </Text>
              </View>
              <PriorityPill priority={preset.priority} />
            </View>

            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { backgroundColor: preset.accentHex, width: '32%' },
                ]}
              />
            </View>

            <View style={styles.previewFoot}>
              <Text style={styles.footTime}>
                {fmtTime(sample.startEpoch)} – {fmtTime(sample.endEpoch)}
              </Text>
              <Text style={[styles.footStatus, { color: preset.accentHex }]}>
                {activityId ? 'Live now' : 'Preview'}
              </Text>
            </View>
          </Card>

          {/* Preset chooser */}
          <View style={styles.presetRow}>
            {PRESETS.map((p) => {
              const active = p.key === presetKey;
              return (
                <Pressable
                  key={p.key}
                  onPress={() => setPresetKey(p.key)}
                  style={[
                    styles.chip,
                    active && { borderColor: p.accentHex, backgroundColor: p.accentHex + '1F' },
                  ]}>
                  <SymbolView
                    name={p.symbol as any}
                    size={14}
                    tintColor={active ? p.accentHex : COLORS.textDim}
                    fallback={<Text style={{ color: COLORS.textDim }}>●</Text>}
                  />
                  <Text
                    style={[
                      styles.chipText,
                      active && { color: COLORS.text },
                    ]}>
                    {p.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          {/* Actions */}
          <Pressable
            onPress={onStart}
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && { opacity: 0.85 },
            ]}>
            <SymbolView
              name="bolt.fill"
              size={16}
              tintColor={COLORS.ink}
              fallback={<Text>⚡</Text>}
            />
            <Text style={styles.primaryBtnText}>
              {activityId ? 'Restart Live Activity' : 'Start Live Activity'}
            </Text>
          </Pressable>

          <Pressable
            onPress={onEnd}
            disabled={!activityId}
            style={({ pressed }) => [
              styles.ghostBtn,
              !activityId && { opacity: 0.4 },
              pressed && { opacity: 0.7 },
            ]}>
            <Text style={styles.ghostBtnText}>End Live Activity</Text>
          </Pressable>

          <Text style={styles.hint}>
            Start it, then lock your iPhone or swipe to the Home Screen to watch
            the timer count down in the Dynamic Island.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.ink },
  safe: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 48, gap: 14 },
  kicker: {
    color: COLORS.brass,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
  },
  h1: {
    color: COLORS.text,
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 34,
  },
  lead: {
    color: COLORS.textDim,
    fontSize: 14.5,
    lineHeight: 21,
    marginBottom: 4,
  },
  card: {
    borderRadius: 22,
    padding: 16,
    overflow: 'hidden',
  },
  cardFallback: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.cardLine,
  },
  preview: { gap: 12 },
  previewTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  taskSub: { color: COLORS.textDim, fontSize: 12.5, marginTop: 1 },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  pillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
  },
  progressFill: { height: 6, borderRadius: 3 },
  previewFoot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footTime: { color: COLORS.textDim, fontSize: 12, fontWeight: '500' },
  footStatus: { fontSize: 12, fontWeight: '700' },
  presetRow: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.cardLine,
    backgroundColor: COLORS.card,
  },
  chipText: { color: COLORS.textDim, fontSize: 13, fontWeight: '600' },
  error: { color: COLORS.red, fontSize: 13, fontWeight: '500' },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.brass,
    paddingVertical: 15,
    borderRadius: 16,
    marginTop: 2,
  },
  primaryBtnText: { color: COLORS.ink, fontSize: 16, fontWeight: '800' },
  ghostBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardLine,
  },
  ghostBtnText: { color: COLORS.textDim, fontSize: 15, fontWeight: '600' },
  hint: {
    color: COLORS.textFaint,
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 6,
  },
});
