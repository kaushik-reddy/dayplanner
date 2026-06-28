import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type Bundle,
  type Task,
  dateKey,
  getCachedBundle,
  getCachedVersion,
  getSyncCode,
  pullBundle,
  pushBundle,
  setSyncCode,
  tasksForDay,
} from './planner';

export type PlannerState = {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  bundle: Bundle | null;
  version: number;
  syncCode: string;
  todayKey: string;
  todayTasks: Task[];
  refresh: () => Promise<void>;
  /** Apply a local mutation to the bundle and push to the cloud. Return false to skip the push. */
  mutate: (fn: (b: Bundle) => void | boolean) => void;
  /** Change the sync code (account) and re-pull. */
  setCode: (code: string) => Promise<void>;
};

function clone(b: Bundle): Bundle {
  return JSON.parse(JSON.stringify(b));
}

export function usePlanner(): PlannerState {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [version, setVersion] = useState(0);
  const [syncCode, setSyncCodeState] = useState('');

  const versionRef = useRef(0);
  const codeRef = useRef('');
  const pushingRef = useRef(false);

  const todayKey = dateKey(new Date());

  const setVer = useCallback((v: number) => {
    versionRef.current = v;
    setVersion(v);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const code = codeRef.current || (await getSyncCode());
      codeRef.current = code;
      setSyncCodeState(code);
      const { version: v, data } = await pullBundle(code);
      setBundle(data);
      setVer(v);
    } catch (e: any) {
      setError(e?.message ?? 'Could not sync.');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [setVer]);

  const mutate = useCallback(
    (fn: (b: Bundle) => void | boolean) => {
      setBundle((prev) => {
        const base: Bundle = prev ? clone(prev) : { days: {} };
        let result: void | boolean;
        try {
          result = fn(base);
        } catch {
          return prev;
        }
        // If the mutator explicitly returns false, nothing changed — skip the push.
        if (result === false) return prev;
        // Push to the cloud in the background (last-write-wins for a solo user).
        (async () => {
          if (pushingRef.current) return;
          pushingRef.current = true;
          try {
            const res = await pushBundle(codeRef.current, versionRef.current, base);
            if (res.ok) setVer(res.version);
            else if (res.conflict && res.data) {
              setBundle(res.data);
              setVer(res.version);
            }
          } catch {
            // offline — local change stays and re-syncs on next push
          } finally {
            pushingRef.current = false;
          }
        })();
        return base;
      });
    },
    [setVer],
  );

  const setCode = useCallback(
    async (code: string) => {
      await setSyncCode(code);
      codeRef.current = code;
      setSyncCodeState(code);
      setVer(0);
      setBundle(null);
      setLoading(true);
      await refresh();
    },
    [refresh, setVer],
  );

  useEffect(() => {
    let active = true;
    (async () => {
      const [code, cached, ver] = await Promise.all([
        getSyncCode(),
        getCachedBundle(),
        getCachedVersion(),
      ]);
      if (!active) return;
      codeRef.current = code;
      setSyncCodeState(code);
      if (cached) {
        setBundle(cached);
        setVer(ver);
        setLoading(false);
      }
      await refresh();
    })();
    return () => {
      active = false;
    };
  }, [refresh, setVer]);

  return {
    loading,
    refreshing,
    error,
    bundle,
    version,
    syncCode,
    todayKey,
    todayTasks: tasksForDay(bundle, todayKey),
    refresh,
    mutate,
    setCode,
  };
}
