import { requireNativeModule } from "expo";
import { Platform } from "react-native";

export type LiveActivityPriority = "low" | "medium" | "high" | "must";

export type LiveActivityTask = {
  /** Stable id of the planner task. */
  taskId: string;
  title: string;
  subtitle?: string;
  /** SF Symbol name, e.g. "person.2.fill". */
  symbol?: string;
  /** Accent color as #RRGGBB. */
  accentHex?: string;
  /** Unix seconds. */
  startEpoch: number;
  /** Unix seconds. */
  endEpoch: number;
  priority?: LiveActivityPriority;
  /** true when the task is in progress, false while upcoming. */
  isRunning?: boolean;
};

type NativeLiveActivity = {
  isSupported(): boolean;
  running(): string[];
  start(task: Required<LiveActivityTask>): Promise<string>;
  update(id: string, task: Required<LiveActivityTask>): Promise<void>;
  end(id: string): Promise<void>;
  endAll(): Promise<void>;
  toast(message: string, kind: string): Promise<void>;
};

const native: NativeLiveActivity | null = (() => {
  if (Platform.OS !== "ios") return null;
  try {
    // Not present in Expo Go — only in a full native build.
    return requireNativeModule("LiveActivity");
  } catch {
    return null;
  }
})();

/** True only in a full native build where the Swift module is linked. */
export const isLiveActivityModuleLinked = native != null;

function normalize(task: LiveActivityTask): Required<LiveActivityTask> {
  return {
    taskId: task.taskId,
    title: task.title,
    subtitle: task.subtitle ?? "",
    symbol: task.symbol ?? "circle.fill",
    accentHex: task.accentHex ?? "#C9974A",
    startEpoch: Math.round(task.startEpoch),
    endEpoch: Math.round(task.endEpoch),
    priority: task.priority ?? "medium",
    isRunning: task.isRunning ?? false,
  };
}

export const LiveActivity = {
  isSupported(): boolean {
    return native?.isSupported() ?? false;
  },
  running(): string[] {
    return native?.running() ?? [];
  },
  async start(task: LiveActivityTask): Promise<string | null> {
    if (!native) return null;
    return native.start(normalize(task));
  },
  async update(id: string, task: LiveActivityTask): Promise<void> {
    if (!native) return;
    return native.update(id, normalize(task));
  },
  async end(id: string): Promise<void> {
    if (!native) return;
    return native.end(id);
  },
  async endAll(): Promise<void> {
    if (!native) return;
    return native.endAll();
  },
  async toast(
    message: string,
    kind: 'success' | 'error' | 'info' = 'success',
  ): Promise<void> {
    if (!native) return;
    return native.toast(message, kind);
  },
};
