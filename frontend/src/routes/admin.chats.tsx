import { useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Eye, RefreshCw, SquarePen } from 'lucide-react';

import { ChatAssistantContent } from '@/components/ChatAssistantContent';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TablePaginationBar, type TablePageSize } from '@/components/table-pagination';
import { useTranslation } from '@/hooks/useTranslation';
import { apiFetchJson, queryKeys } from '@/lib/api';
import { pastelChipClassForSeed } from '@/lib/pastel-chip-colors';
import {
  AdminDateRangePicker,
  presetToRange,
  type AdminRangePreset,
} from '@/components/admin/AdminDateRangePicker';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type AdminChatsOverview = {
  range: { from: string | null; to: string | null };
  messages: {
    today: number;
    week: number;
    month: number;
    year: number;
    flagged_total: number;
    in_range: number;
  };
  messages_over_time?: {
    grain: 'hour' | 'day' | 'week' | 'month';
    points: { period_start: string; message_count: number }[];
  } | null;
  answer_time_stats?: {
    min_ms: number | null;
    max_ms: number | null;
    avg_ms: number | null;
    n: number;
  } | null;
  llm_usage: { used_llm_id: number; used_llm_name: string; message_count: number }[];
};

type AdminChatLlmUsed = {
  used_llm_id: number;
  used_llm_name: string;
};

type AdminChatRow = {
  chat_id: number;
  title: string | null;
  start_time: string;
  app_user_id: number;
  user_email: string;
  last_message_time: string | null;
  message_count: number;
  flagged_count: number;
  llms_used: AdminChatLlmUsed[] | null;
};

type AdminChatListResponse = {
  limit: number | 'all';
  offset: number;
  total: number;
  rows: AdminChatRow[];
};

function LlmTiles({
  items,
  noneLabel,
}: {
  items: AdminChatLlmUsed[] | null | undefined;
  noneLabel: string;
}) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    return <span className="text-xs text-muted-foreground">{noneLabel}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5 max-w-[20rem]">
      {list.map((llm) => {
        const chipClass = pastelChipClassForSeed(`${llm.used_llm_id}:${llm.used_llm_name}`);
        return (
          <span
            key={llm.used_llm_id}
            className={`inline-flex max-w-full items-center rounded-md px-2.5 py-0.5 text-xs font-medium ${chipClass}`}
            title={llm.used_llm_name}
          >
            <span className="truncate">{llm.used_llm_name}</span>
          </span>
        );
      })}
    </div>
  );
}

type AdminChatMessagesResponse = {
  chat: {
    chat_id: number;
    title: string | null;
    start_time: string;
    app_user_id: number;
    user_email: string;
  };
  range: { from: string | null; to: string | null };
  rows: {
    message_id: number;
    encrypted_content: string;
    sent_time: string;
    is_sent_by_user: boolean;
    is_flagged_by_user: boolean;
    used_llm_id: number | null;
    used_llm_name: string | null;
  }[];
};

function toIsoRange(fromYmd: string, toYmd: string): { from: string; to: string } | null {
  if (!fromYmd || !toYmd) return null;
  const mFrom = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromYmd.trim());
  const mTo = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toYmd.trim());
  if (!mFrom || !mTo) return null;
  const fy = Number(mFrom[1]);
  const fm = Number(mFrom[2]);
  const fd = Number(mFrom[3]);
  const ty = Number(mTo[1]);
  const tm = Number(mTo[2]);
  const td = Number(mTo[3]);
  // Presets and <input type="date"> are calendar days in the user's locale; interpret as local
  // midnight boundaries, then send UTC instants to the API. "To" is inclusive → exclusive end
  // is local midnight of the day after `toYmd`.
  const from = new Date(fy, fm - 1, fd, 0, 0, 0, 0);
  const toExclusive = new Date(ty, tm - 1, td + 1, 0, 0, 0, 0);
  if (Number.isNaN(from.getTime()) || Number.isNaN(toExclusive.getTime())) return null;
  if (toExclusive.getTime() <= from.getTime()) return null;
  return { from: from.toISOString(), to: toExclusive.toISOString() };
}

function ymdToDmy(value: string): string {
  const t = (value ?? '').trim();
  if (!t) return '';

  // Fast-path for <input type="date"> values.
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [, yyyy, mm, dd] = m;
    return `${dd}.${mm}.${yyyy}`;
  }

  // Fallback for ISO strings or other parseable timestamps.
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function toYmd(d: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfWeekMonday(d: Date): Date {
  // JS: Sunday=0 ... Saturday=6. We want Monday-based week start.
  const day = d.getDay();
  const diff = (day + 6) % 7; // Monday=0 ... Sunday=6
  const start = new Date(d);
  start.setDate(d.getDate() - diff);
  start.setHours(0, 0, 0, 0);
  return start;
}

function startOfMonth(d: Date): Date {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  start.setHours(0, 0, 0, 0);
  return start;
}

function formatDateTime(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${String(sec).padStart(2, '0')}s`;
}

const MS_DAY = 86_400_000;
const MS_HOUR = 3_600_000;
/** Day-of-month ticks for long ranges (1, 5, 10, 15, …). */
const LONG_SPAN_DOM = new Set([1, 5, 10, 15, 20, 25, 30]);
const MESSAGES_CHART_MAX_TICKS = 18;

function formatSignedPercent(pct: number): string {
  const rounded = Math.round(pct);
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}%`;
}

function percentChange(
  current: number | null | undefined,
  previous: number | null | undefined
): number | null {
  if (current == null || previous == null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function dedupeSortedMs(values: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out.sort((a, b) => a - b);
}

function subsampleSortedTicks(sorted: number[], maxCount: number): number[] {
  if (sorted.length <= maxCount) return sorted;
  const n = sorted.length;
  const out: number[] = [];
  for (let i = 0; i < maxCount; i++) {
    const idx = Math.floor((i * (n - 1)) / (maxCount - 1));
    out.push(sorted[idx]);
  }
  return dedupeSortedMs(out);
}

function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function eachLocalCalendarNoonInRange(
  domainLo: number,
  domainHi: number,
  includeDay: (dayOfMonth: number) => boolean
): number[] {
  const ticks: number[] = [];
  const d = new Date(domainLo);
  d.setHours(0, 0, 0, 0);
  const end = new Date(domainHi);
  while (d.getTime() <= end.getTime()) {
    if (includeDay(d.getDate())) {
      const noon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
      const t = noon.getTime();
      if (t >= domainLo && t <= domainHi) ticks.push(t);
    }
    d.setDate(d.getDate() + 1);
  }
  return dedupeSortedMs(ticks);
}

function buildShortSpanTicks(
  domainLo: number,
  domainHi: number,
  toExclusiveMs: number
): {
  ticks: number[];
  tickFormatter: (ms: number) => string;
} {
  const spanMs = toExclusiveMs - domainLo;
  const spanHours = spanMs / MS_HOUR;
  const target = 9;
  const rough = spanHours / target;
  const niceHours = [1, 2, 3, 4, 6, 8, 12].find((h) => h >= rough) ?? 12;
  const step = niceHours * MS_HOUR;

  let t = Math.floor(domainLo / step) * step;
  if (t < domainLo) t += step;
  const ticks: number[] = [];
  for (; t <= domainHi; t += step) ticks.push(t);
  if (ticks.length === 0) ticks.push(domainLo, domainHi);

  const firstMsByLocalDay = new Map<string, number>();
  for (const ms of ticks) {
    const key = localDayKey(ms);
    const prev = firstMsByLocalDay.get(key);
    if (prev === undefined || ms < prev) firstMsByLocalDay.set(key, ms);
  }

  const tickFormatter = (ms: number): string => {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    const key = localDayKey(ms);
    const timePart = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (firstMsByLocalDay.get(key) === ms) {
      const datePart = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      return `${datePart} ${timePart}`;
    }
    return timePart;
  };

  return { ticks: dedupeSortedMs(ticks), tickFormatter };
}

function buildMessagesChartAxisConfig(
  domainLo: number,
  domainHi: number,
  toExclusiveMs: number,
  grain: 'hour' | 'day' | 'week' | 'month',
  dataTimestamps: number[]
): { ticks: number[]; tickFormatter: (ms: number) => string } {
  const spanDays = Math.max((toExclusiveMs - domainLo) / MS_DAY, 1e-9);

  if (grain === 'month') {
    const ticks = dedupeSortedMs(dataTimestamps.filter((x) => x >= domainLo && x <= domainHi));
    const tickFormatter = (ms: number): string =>
      new Date(ms).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    return { ticks: ticks.length ? ticks : [domainLo, domainHi], tickFormatter };
  }

  if (spanDays <= 3) {
    return buildShortSpanTicks(domainLo, domainHi, toExclusiveMs);
  }

  if (spanDays <= 21) {
    let ticks = eachLocalCalendarNoonInRange(domainLo, domainHi, (dom) => dom % 2 === 0);
    if (ticks.length === 0) ticks = [domainLo, domainHi];
    ticks = subsampleSortedTicks(ticks, MESSAGES_CHART_MAX_TICKS);
    const tickFormatter = (ms: number): string =>
      new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return { ticks, tickFormatter };
  }

  let ticks = eachLocalCalendarNoonInRange(domainLo, domainHi, (dom) => LONG_SPAN_DOM.has(dom));
  if (ticks.length === 0) ticks = [domainLo, domainHi];
  ticks = subsampleSortedTicks(ticks, MESSAGES_CHART_MAX_TICKS);
  const tickFormatter = (ms: number): string =>
    new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return { ticks, tickFormatter };
}

export const Route = createFileRoute('/admin/chats' as any)({
  beforeLoad: async () => {
    const isAuthenticated = sessionStorage.getItem('isAuthenticated') === 'true';
    if (!isAuthenticated) throw redirect({ to: '/login' as any });

    let roles: { user_role_code: string; user_role_name: string }[] = [];
    try {
      roles = await apiFetchJson('/api/user/roles');
    } catch {
      throw redirect({ to: '/login' as any });
    }
    if (!roles.some((r) => r.user_role_code === 'ADM')) throw redirect({ to: '/' as any });
  },
  component: AdminChatsPage,
});

export default function AdminChatsPage() {
  const { t } = useTranslation();

  const chatsSectionRef = useRef<HTMLDivElement | null>(null);
  const messagesSectionRef = useRef<HTMLDivElement | null>(null);
  const scrollToMessagesPendingRef = useRef(false);

  const [selectedChatId, setSelectedChatId] = useState<number | null>(null);
  const [messagesFlaggedOnly, setMessagesFlaggedOnly] = useState(false);
  const [messagesDir, setMessagesDir] = useState<'asc' | 'desc'>('asc');
  const [messageSearch, setMessageSearch] = useState('');
  const [senderFilter, setSenderFilter] = useState<'all' | 'user' | 'assistant'>('all');

  // When enabled, the overview panels (chart + LLM usage) use flagged messages only.
  const [overviewFlaggedOnly, setOverviewFlaggedOnly] = useState(false);

  // Global timeframe is controlled via the last stat tile (modal).
  const initialTile = useMemo(() => presetToRange('last7'), []);
  const [tilePreset, setTilePreset] = useState<AdminRangePreset>('last7');
  const [tileFromYmd, setTileFromYmd] = useState<string>(initialTile.from ?? '');
  const [tileToYmd, setTileToYmd] = useState<string>(initialTile.to ?? '');
  const selectedIsoRange = useMemo(
    () => toIsoRange(tileFromYmd, tileToYmd),
    [tileFromYmd, tileToYmd]
  );

  const [tileModalOpen, setTileModalOpen] = useState(false);
  const [draftPreset, setDraftPreset] = useState<AdminRangePreset>('last7');
  const [draftFromYmd, setDraftFromYmd] = useState<string>(initialTile.from ?? '');
  const [draftToYmd, setDraftToYmd] = useState<string>(initialTile.to ?? '');

  // Chat list controls (kept here so the admin can still filter/sort chats; not shown at the very top anymore).
  const [chatSearch, setChatSearch] = useState('');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [sortKey, setSortKey] = useState<
    'last_message_time' | 'message_count' | 'flagged_count' | 'email'
  >('last_message_time');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [llmFilterId, setLlmFilterId] = useState<number | null>(null);
  const [chatPageSize, setChatPageSize] = useState<TablePageSize>(10);
  const [chatPageIndex, setChatPageIndex] = useState(0);

  // Comparison ranges for top tiles (today/week/month).
  const todayLocal = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const yesterdayLocal = useMemo(() => {
    const d = new Date(todayLocal);
    d.setDate(d.getDate() - 1);
    return d;
  }, [todayLocal]);

  const thisWeekStartLocal = useMemo(() => startOfWeekMonday(new Date()), []);
  const lastWeekStartLocal = useMemo(() => {
    const d = new Date(thisWeekStartLocal);
    d.setDate(d.getDate() - 7);
    return d;
  }, [thisWeekStartLocal]);
  const lastWeekEndLocal = useMemo(() => {
    const d = new Date(thisWeekStartLocal);
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [thisWeekStartLocal]);

  const thisMonthStartLocal = useMemo(() => startOfMonth(new Date()), []);
  const lastMonthStartLocal = useMemo(
    () =>
      startOfMonth(
        new Date(thisMonthStartLocal.getFullYear(), thisMonthStartLocal.getMonth() - 1, 1)
      ),
    [thisMonthStartLocal]
  );
  const lastMonthEndLocal = useMemo(() => {
    const d = new Date(thisMonthStartLocal);
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [thisMonthStartLocal]);

  // Stat tiles: today/week/month/year are fetched once (no timeframe params).
  const {
    data: fixedStatsOverview,
    isFetching: isFetchingFixedStats,
    refetch: refetchFixedStats,
  } = useQuery({
    queryKey: queryKeys.adminChatsOverview(null, null, false),
    queryFn: () => apiFetchJson<AdminChatsOverview>(`/api/admin/chats/overview`),
  });

  const yesterdayRangeIso = useMemo(
    () => toIsoRange(toYmd(yesterdayLocal), toYmd(yesterdayLocal)),
    [yesterdayLocal]
  );
  const lastWeekRangeIso = useMemo(
    () => toIsoRange(toYmd(lastWeekStartLocal), toYmd(lastWeekEndLocal)),
    [lastWeekEndLocal, lastWeekStartLocal]
  );
  const lastMonthRangeIso = useMemo(
    () => toIsoRange(toYmd(lastMonthStartLocal), toYmd(lastMonthEndLocal)),
    [lastMonthEndLocal, lastMonthStartLocal]
  );

  const { data: yesterdayOverview } = useQuery({
    queryKey: queryKeys.adminChatsOverview(
      yesterdayRangeIso?.from ?? null,
      yesterdayRangeIso?.to ?? null,
      false
    ),
    queryFn: () =>
      apiFetchJson<AdminChatsOverview>(
        `/api/admin/chats/overview?from=${encodeURIComponent(yesterdayRangeIso?.from ?? '')}&to=${encodeURIComponent(
          yesterdayRangeIso?.to ?? ''
        )}`
      ),
    enabled: yesterdayRangeIso != null,
  });

  const { data: lastWeekOverview } = useQuery({
    queryKey: queryKeys.adminChatsOverview(
      lastWeekRangeIso?.from ?? null,
      lastWeekRangeIso?.to ?? null,
      false
    ),
    queryFn: () =>
      apiFetchJson<AdminChatsOverview>(
        `/api/admin/chats/overview?from=${encodeURIComponent(lastWeekRangeIso?.from ?? '')}&to=${encodeURIComponent(
          lastWeekRangeIso?.to ?? ''
        )}`
      ),
    enabled: lastWeekRangeIso != null,
  });

  const { data: lastMonthOverview } = useQuery({
    queryKey: queryKeys.adminChatsOverview(
      lastMonthRangeIso?.from ?? null,
      lastMonthRangeIso?.to ?? null,
      false
    ),
    queryFn: () =>
      apiFetchJson<AdminChatsOverview>(
        `/api/admin/chats/overview?from=${encodeURIComponent(lastMonthRangeIso?.from ?? '')}&to=${encodeURIComponent(
          lastMonthRangeIso?.to ?? ''
        )}`
      ),
    enabled: lastMonthRangeIso != null,
  });

  const todayDeltaPct = useMemo(
    () =>
      percentChange(
        fixedStatsOverview?.messages.today ?? null,
        yesterdayOverview?.messages.in_range ?? null
      ),
    [fixedStatsOverview?.messages.today, yesterdayOverview?.messages.in_range]
  );
  const weekDeltaPct = useMemo(
    () =>
      percentChange(
        fixedStatsOverview?.messages.week ?? null,
        lastWeekOverview?.messages.in_range ?? null
      ),
    [fixedStatsOverview?.messages.week, lastWeekOverview?.messages.in_range]
  );
  const monthDeltaPct = useMemo(
    () =>
      percentChange(
        fixedStatsOverview?.messages.month ?? null,
        lastMonthOverview?.messages.in_range ?? null
      ),
    [fixedStatsOverview?.messages.month, lastMonthOverview?.messages.in_range]
  );

  // Selected timeframe (drives: in-range tile + llm usage + chats + messages).
  const {
    data: selectedRangeOverview,
    isFetching: isFetchingSelectedRangeOverview,
    refetch: refetchSelectedRangeOverview,
  } = useQuery({
    queryKey: queryKeys.adminChatsOverview(
      selectedIsoRange?.from ?? null,
      selectedIsoRange?.to ?? null,
      overviewFlaggedOnly
    ),
    queryFn: () =>
      apiFetchJson<AdminChatsOverview>(
        `/api/admin/chats/overview?from=${encodeURIComponent(selectedIsoRange?.from ?? '')}&to=${encodeURIComponent(selectedIsoRange?.to ?? '')}&flagged_only=${overviewFlaggedOnly}`
      ),
    enabled: selectedIsoRange != null,
  });

  const chatListOffset = chatPageSize === 'all' ? 0 : chatPageIndex * chatPageSize;
  const chatListLimitParam = chatPageSize === 'all' ? 'all' : String(chatPageSize);

  const chatListParamsKey = useMemo(() => {
    const parts = [
      `from=${selectedIsoRange?.from ?? ''}`,
      `to=${selectedIsoRange?.to ?? ''}`,
      `q=${chatSearch.trim()}`,
      `flagged_only=${flaggedOnly}`,
      `sort=${sortKey}`,
      `dir=${sortDir}`,
      `llm=${llmFilterId ?? ''}`,
      `limit=${chatListLimitParam}`,
      `offset=${chatListOffset}`,
    ];
    return parts.join('&');
  }, [
    chatListLimitParam,
    chatListOffset,
    chatSearch,
    flaggedOnly,
    llmFilterId,
    selectedIsoRange?.from,
    selectedIsoRange?.to,
    sortDir,
    sortKey,
  ]);

  const {
    data: chatsResp,
    isFetching: isFetchingChats,
    refetch: refetchChats,
  } = useQuery({
    queryKey: queryKeys.adminChats(chatListParamsKey),
    queryFn: () => {
      const llmQ =
        llmFilterId != null ? `&used_llm_id=${encodeURIComponent(String(llmFilterId))}` : '';
      return apiFetchJson<AdminChatListResponse>(
        `/api/admin/chats?from=${encodeURIComponent(selectedIsoRange?.from ?? '')}&to=${encodeURIComponent(selectedIsoRange?.to ?? '')}&q=${encodeURIComponent(chatSearch.trim())}&flagged_only=${flaggedOnly}&sort=${sortKey}&dir=${sortDir}&limit=${encodeURIComponent(chatListLimitParam)}&offset=${encodeURIComponent(String(chatListOffset))}${llmQ}`
      );
    },
    enabled: selectedIsoRange != null,
  });

  useEffect(() => {
    setChatPageIndex(0);
  }, [
    chatSearch,
    flaggedOnly,
    sortKey,
    sortDir,
    llmFilterId,
    chatPageSize,
    tileFromYmd,
    tileToYmd,
  ]);

  const {
    data: messagesResp,
    isFetching: isFetchingMessages,
    refetch: refetchMessages,
  } = useQuery({
    queryKey:
      selectedChatId != null
        ? queryKeys.adminChatMessages(
            selectedChatId,
            selectedIsoRange?.from ?? null,
            selectedIsoRange?.to ?? null,
            messagesFlaggedOnly,
            messagesDir
          )
        : ['admin-chat-messages-none'],
    queryFn: () =>
      apiFetchJson<AdminChatMessagesResponse>(
        `/api/admin/chats/${selectedChatId}/messages?from=${encodeURIComponent(selectedIsoRange?.from ?? '')}&to=${encodeURIComponent(selectedIsoRange?.to ?? '')}&flagged_only=${messagesFlaggedOnly}&dir=${messagesDir}`
      ),
    enabled: selectedChatId != null && selectedIsoRange != null,
  });

  const chats = chatsResp?.rows ?? [];
  const selectedChat = chats.find((c) => c.chat_id === selectedChatId) ?? null;

  const messagesOverTime = selectedRangeOverview?.messages_over_time;
  const answerTimeStats = selectedRangeOverview?.answer_time_stats ?? null;

  const messagesChartData = useMemo(() => {
    if (!messagesOverTime?.points?.length) return [];
    return [...messagesOverTime.points]
      .map((p) => ({
        ...p,
        t: new Date(p.period_start).getTime(),
      }))
      .sort((a, b) => a.t - b.t);
  }, [messagesOverTime]);

  /**
   * X-axis domain: selected range [from, to) in local time, expanded to include every series point.
   * Bucket starts from PostgreSQL use the session timezone (typically UTC), so the first/last
   * `period_start` can sit slightly before `from` or after the inclusive end — Recharts would
   * clip those points if the domain were only the raw range.
   */
  const messagesTimeAxisDomain = useMemo((): [number, number] | null => {
    if (!selectedIsoRange) return null;
    const lo = new Date(selectedIsoRange.from).getTime();
    const hiEx = new Date(selectedIsoRange.to).getTime();
    if (!Number.isFinite(lo) || !Number.isFinite(hiEx) || hiEx <= lo) return null;
    const rangeHiIncl = hiEx - 1;
    if (messagesChartData.length === 0) return [lo, rangeHiIncl];
    let dMin = Infinity;
    let dMax = -Infinity;
    for (const row of messagesChartData) {
      if (row.t < dMin) dMin = row.t;
      if (row.t > dMax) dMax = row.t;
    }
    return [Math.min(lo, dMin), Math.max(rangeHiIncl, dMax)];
  }, [selectedIsoRange, messagesChartData]);

  const messagesSpanDays = useMemo(() => {
    if (!selectedIsoRange) return null;
    const lo = new Date(selectedIsoRange.from).getTime();
    const hiEx = new Date(selectedIsoRange.to).getTime();
    if (!Number.isFinite(lo) || !Number.isFinite(hiEx) || hiEx <= lo) return null;
    return (hiEx - lo) / MS_DAY;
  }, [selectedIsoRange]);

  const messagesChartAxis = useMemo(() => {
    if (messagesTimeAxisDomain == null || !selectedIsoRange || !messagesOverTime) return null;
    const [lo, hi] = messagesTimeAxisDomain;
    const toEx = new Date(selectedIsoRange.to).getTime();
    return buildMessagesChartAxisConfig(
      lo,
      hi,
      toEx,
      messagesOverTime.grain,
      messagesChartData.map((d) => d.t)
    );
  }, [messagesTimeAxisDomain, selectedIsoRange, messagesOverTime, messagesChartData]);

  const chatTotal = chatsResp?.total ?? 0;
  const chatPageCount =
    chatPageSize === 'all' ? 1 : Math.max(1, Math.ceil(chatTotal / chatPageSize));
  const rangeFrom =
    chatTotal === 0 ? 0 : chatPageSize === 'all' ? 1 : chatPageIndex * chatPageSize + 1;
  const rangeTo =
    chatTotal === 0
      ? 0
      : chatPageSize === 'all'
        ? chatTotal
        : Math.min(chatTotal, chatPageIndex * chatPageSize + chats.length);

  useEffect(() => {
    if (chatPageSize === 'all') return;
    const tp = Math.max(1, Math.ceil(chatTotal / chatPageSize));
    if (chatPageIndex > tp - 1) {
      setChatPageIndex(Math.max(0, tp - 1));
    }
  }, [chatPageIndex, chatPageSize, chatTotal]);

  const filteredMessages = useMemo(() => {
    const rows = messagesResp?.rows ?? [];
    const q = messageSearch.trim().toLowerCase();
    return rows.filter((m) => {
      if (senderFilter === 'user' && !m.is_sent_by_user) return false;
      if (senderFilter === 'assistant' && m.is_sent_by_user) return false;
      if (!q) return true;
      return (m.encrypted_content ?? '').toLowerCase().includes(q);
    });
  }, [messageSearch, messagesResp?.rows, senderFilter]);

  const refreshAll = () => {
    void refetchFixedStats();
    void refetchSelectedRangeOverview();
    void refetchChats();
    if (selectedChatId != null) void refetchMessages();
  };

  const openTimeframeModal = () => {
    setFlaggedOnly(false);
    setDraftPreset(tilePreset);
    setDraftFromYmd(tileFromYmd);
    setDraftToYmd(tileToYmd);
    setTileModalOpen(true);
  };

  const cancelTimeframeModal = () => {
    setTileModalOpen(false);
  };

  const saveTimeframeModal = () => {
    if (draftPreset === 'custom') {
      // Apply draft custom range
      setTilePreset('custom');
      setTileFromYmd(draftFromYmd);
      setTileToYmd(draftToYmd);
      setTileModalOpen(false);
      return;
    }
    const r = presetToRange(draftPreset);
    setTilePreset(draftPreset);
    setTileFromYmd(r.from ?? '');
    setTileToYmd(r.to ?? '');
    setTileModalOpen(false);
  };

  const applyPageTimeframe = (
    fromYmd: string,
    toYmd: string,
    preset: AdminRangePreset = 'custom'
  ) => {
    setOverviewFlaggedOnly(false);
    setFlaggedOnly(false);
    setTilePreset(preset);
    setTileFromYmd(fromYmd);
    setTileToYmd(toYmd);
    // Leaving the draft state as-is; it gets re-synced when opening the modal.
  };

  const applyToday = () => {
    const now = new Date();
    const ymd = toYmd(now);
    applyPageTimeframe(ymd, ymd, 'custom');
  };

  const applyThisWeek = () => {
    const now = new Date();
    applyPageTimeframe(toYmd(startOfWeekMonday(now)), toYmd(now), 'custom');
  };

  const applyThisMonth = () => {
    const now = new Date();
    applyPageTimeframe(toYmd(startOfMonth(now)), toYmd(now), 'custom');
  };

  const applyAllTimeFromBounds = (bounds: {
    min_sent_time: string | null;
    max_sent_time: string | null;
  }) => {
    const minIso = bounds.min_sent_time;
    const maxIso = bounds.max_sent_time;
    const min = minIso ? new Date(minIso) : null;
    const max = maxIso ? new Date(maxIso) : null;
    const fromYmd = min && !Number.isNaN(min.getTime()) ? toYmd(min) : toYmd(new Date());
    const toYmdValue = max && !Number.isNaN(max.getTime()) ? toYmd(max) : toYmd(new Date());
    applyPageTimeframe(fromYmd, toYmdValue, 'custom');
  };

  const openChatAndScroll = (chatId: number) => {
    scrollToMessagesPendingRef.current = true;
    setSelectedChatId(chatId);
  };

  const openChatsAndFlaggedOnly = async () => {
    try {
      const bounds = await apiFetchJson<{
        min_sent_time: string | null;
        max_sent_time: string | null;
      }>(`/api/admin/chats/bounds?flagged_only=true`);
      applyAllTimeFromBounds(bounds);
    } catch {
      // If bounds fetch fails, keep current timeframe and still apply filters.
    }
    setOverviewFlaggedOnly(true);
    setFlaggedOnly(true);
  };

  useEffect(() => {
    if (!scrollToMessagesPendingRef.current) return;
    if (selectedChatId == null) return;
    if (isFetchingMessages) return;

    // By scrolling after the messages have loaded, the top of the messages tile
    // reliably lands at the top of the viewport even for long chats.
    window.requestAnimationFrame(() => {
      messagesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      scrollToMessagesPendingRef.current = false;
    });
  }, [isFetchingMessages, selectedChatId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PageHeader title={t('adminChats.title')} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-6 py-8 space-y-6">
          <div className="rounded-lg border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">
            {t('adminChats.clickToChangeTimeframe')}
          </div>
          <div
            id="admin-chats-stats-section"
            className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-5 scroll-mt-24"
          >
            <Card
              className="p-3 hover:bg-muted/40 transition-colors cursor-pointer"
              role="button"
              tabIndex={0}
              onClick={applyToday}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') applyToday();
              }}
              aria-label={t('adminChats.messagesToday')}
            >
              <div className="min-h-8 text-[11px] uppercase tracking-wide text-muted-foreground leading-tight">
                {t('adminChats.messagesToday')}
              </div>
              <div className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">
                {fixedStatsOverview?.messages.today ?? '—'}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {todayDeltaPct == null
                  ? '—'
                  : `${formatSignedPercent(todayDeltaPct)} ${t('adminChats.vsYesterday')}`}
              </div>
            </Card>
            <Card
              className="p-3 hover:bg-muted/40 transition-colors cursor-pointer"
              role="button"
              tabIndex={0}
              onClick={applyThisWeek}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') applyThisWeek();
              }}
              aria-label={t('adminChats.messagesWeek')}
            >
              <div className="min-h-8 text-[11px] uppercase tracking-wide text-muted-foreground leading-tight">
                {t('adminChats.messagesWeek')}
              </div>
              <div className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">
                {fixedStatsOverview?.messages.week ?? '—'}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {weekDeltaPct == null
                  ? '—'
                  : `${formatSignedPercent(weekDeltaPct)} ${t('adminChats.vsLastWeek')}`}
              </div>
            </Card>
            <Card
              className="p-3 hover:bg-muted/40 transition-colors cursor-pointer"
              role="button"
              tabIndex={0}
              onClick={applyThisMonth}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') applyThisMonth();
              }}
              aria-label={t('adminChats.messagesMonth')}
            >
              <div className="min-h-8 text-[11px] uppercase tracking-wide text-muted-foreground leading-tight">
                {t('adminChats.messagesMonth')}
              </div>
              <div className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">
                {fixedStatsOverview?.messages.month ?? '—'}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {monthDeltaPct == null
                  ? '—'
                  : `${formatSignedPercent(monthDeltaPct)} ${t('adminChats.vsLastMonth')}`}
              </div>
            </Card>
            <Card
              className="p-3 hover:bg-muted/40 transition-colors cursor-pointer relative"
              role="button"
              tabIndex={0}
              onClick={openTimeframeModal}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') openTimeframeModal();
              }}
              aria-label={t('adminChats.messagesInRange')}
            >
              <div className="min-h-8 text-[11px] uppercase tracking-wide text-muted-foreground leading-tight">
                {t('adminChats.messagesInRange')}
              </div>
              <div className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">
                {isFetchingSelectedRangeOverview
                  ? '—'
                  : (selectedRangeOverview?.messages.in_range ?? '—')}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {`${ymdToDmy(tileFromYmd) || '—'} – ${ymdToDmy(tileToYmd) || '—'}`}
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openTimeframeModal();
                }}
                title={t('adminChats.timeframe')}
                aria-label={t('adminChats.timeframe')}
              >
                <SquarePen className="h-4 w-4" />
              </Button>
            </Card>

            <Card
              className="p-3 hover:bg-muted/40 transition-colors cursor-pointer"
              role="button"
              tabIndex={0}
              onClick={openChatsAndFlaggedOnly}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') openChatsAndFlaggedOnly();
              }}
              aria-label={t('adminChats.flaggedMessagesAllTime')}
            >
              <div className="min-h-8 text-[11px] uppercase tracking-wide text-muted-foreground leading-tight">
                {t('adminChats.flaggedMessagesAllTime')}
              </div>
              <div className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">
                {fixedStatsOverview?.messages.flagged_total ?? '—'}
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
            <Card className="min-w-0 overflow-hidden lg:col-span-2">
              <div className="border-b border-border px-4 py-3">
                <div className="text-sm font-semibold">{t('adminChats.messagesOverTimeTitle')}</div>
                <div className="text-xs text-muted-foreground">
                  {t('adminChats.messagesOverTimeHint')}
                </div>
              </div>
              <div className="p-4 pt-2">
                {isFetchingSelectedRangeOverview ? (
                  <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
                    {t('common.loading')}
                  </div>
                ) : !messagesOverTime?.points?.length ||
                  messagesTimeAxisDomain == null ||
                  messagesChartAxis == null ? (
                  <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
                    {t('adminChats.messagesOverTimeEmpty')}
                  </div>
                ) : (
                  <div className="h-[280px] w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={messagesChartData}
                        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="messagesFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
                            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                        <XAxis
                          type="number"
                          dataKey="t"
                          domain={messagesTimeAxisDomain}
                          scale="time"
                          allowDataOverflow
                          ticks={messagesChartAxis.ticks}
                          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                          tickLine={false}
                          axisLine={{ stroke: 'var(--border)' }}
                          tickFormatter={messagesChartAxis.tickFormatter}
                        />
                        <YAxis
                          width={36}
                          allowDecimals={false}
                          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                          tickLine={false}
                          axisLine={{ stroke: 'var(--border)' }}
                        />
                        <Tooltip
                          contentStyle={{
                            background: 'var(--card)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-md)',
                            fontSize: '12px',
                          }}
                          labelFormatter={(label, items) => {
                            const row = items?.[0]?.payload as
                              | { period_start?: string }
                              | undefined;
                            const iso =
                              row?.period_start ??
                              (typeof label === 'number' && Number.isFinite(label)
                                ? new Date(label).toISOString()
                                : null);
                            if (!iso) return '';
                            const d = new Date(iso);
                            if (Number.isNaN(d.getTime())) return iso;
                            const spanDays = messagesSpanDays ?? 0;
                            // For long spans, prefer day-level labeling even if the API returns hourly grain.
                            if (spanDays > 3 && messagesOverTime.grain === 'hour') {
                              return d.toLocaleDateString(undefined, {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              });
                            }
                            if (messagesOverTime.grain === 'month') {
                              return d.toLocaleDateString(undefined, {
                                month: 'long',
                                year: 'numeric',
                              });
                            }
                            if (messagesOverTime.grain === 'week') {
                              return d.toLocaleDateString(undefined, {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              });
                            }
                            if (messagesOverTime.grain === 'hour') {
                              return d.toLocaleString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: 'numeric',
                              });
                            }
                            return d.toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            });
                          }}
                          formatter={(value: number) => [value, t('adminChats.messageCount')]}
                        />
                        <Area
                          type="monotone"
                          dataKey="message_count"
                          stroke="none"
                          fill="url(#messagesFill)"
                          tooltipType="none"
                          activeDot={false}
                          isAnimationActive={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="message_count"
                          stroke="var(--chart-1)"
                          strokeWidth={2}
                          dot={
                            messagesChartData.length > 48 ? false : { r: 3, fill: 'var(--chart-1)' }
                          }
                          activeDot={{ r: 5 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </Card>

            <div
              id="admin-chats-llm-section"
              className="flex min-h-0 min-w-0 flex-col rounded-lg border border-border bg-card scroll-mt-24 lg:col-span-1"
            >
              <div className="border-b border-border p-4">
                <div className="text-sm font-semibold">{t('adminChats.llmUsageTitle')}</div>
                <div className="text-xs text-muted-foreground">{t('adminChats.llmUsageHint')}</div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-4">
                <div className="mb-4 rounded-md border border-border/60 bg-muted/20 p-3">
                  <div className="text-[12px] font-semibold text-foreground">
                    {t('adminChats.answerTimeTitle')}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
                    <div>
                      <div className="text-muted-foreground">{t('adminChats.min')}</div>
                      <div className="tabular-nums text-foreground">
                        {isFetchingSelectedRangeOverview
                          ? '—'
                          : formatDurationMs(answerTimeStats?.min_ms)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">{t('adminChats.avg')}</div>
                      <div className="tabular-nums text-foreground">
                        {isFetchingSelectedRangeOverview
                          ? '—'
                          : formatDurationMs(answerTimeStats?.avg_ms)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">{t('adminChats.max')}</div>
                      <div className="tabular-nums text-foreground">
                        {isFetchingSelectedRangeOverview
                          ? '—'
                          : formatDurationMs(answerTimeStats?.max_ms)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    {isFetchingSelectedRangeOverview
                      ? ''
                      : t('adminChats.answerTimeN', { n: answerTimeStats?.n ?? 0 })}
                  </div>
                </div>
                {isFetchingSelectedRangeOverview ? (
                  <div className="text-sm text-muted-foreground">{t('common.loading')}</div>
                ) : (selectedRangeOverview?.llm_usage?.length ?? 0) === 0 ? (
                  <div className="text-sm text-muted-foreground">{t('adminChats.noLlmUsage')}</div>
                ) : (
                  (() => {
                    const rows = [...(selectedRangeOverview?.llm_usage ?? [])].sort(
                      (a, b) => b.message_count - a.message_count
                    );
                    const total = rows.reduce((acc, r) => acc + (r.message_count ?? 0), 0);
                    const max = Math.max(...rows.map((r) => r.message_count ?? 0), 1);
                    const colorForIdx = (idx: number) => `var(--chart-${(idx % 5) + 1})`;

                    return (
                      <div className="space-y-3">
                        <div className="space-y-3">
                          {rows.map((r, idx) => {
                            const pct = Math.max(0, Math.min(1, (r.message_count ?? 0) / max));
                            const color = colorForIdx(idx);
                            return (
                              <div key={r.used_llm_id} className="space-y-2">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex items-center gap-2">
                                    <span
                                      className="mt-[3px] h-2 w-2 shrink-0 rounded-full"
                                      style={{ backgroundColor: color }}
                                      aria-hidden="true"
                                    />
                                    <div className="min-w-0 text-[13px] text-foreground break-words">
                                      {r.used_llm_name}
                                    </div>
                                  </div>
                                  <div className="shrink-0 text-[13px] tabular-nums text-foreground">
                                    {r.message_count}
                                  </div>
                                </div>
                                <div className="h-2 w-full rounded-full bg-muted/60 overflow-hidden">
                                  <div
                                    className="h-full rounded-full"
                                    style={{ width: `${pct * 100}%`, backgroundColor: color }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="pt-2 border-t border-border flex items-center justify-between text-[13px]">
                          <div className="text-muted-foreground">{t('adminChats.total')}</div>
                          <div className="tabular-nums">{total}</div>
                        </div>
                      </div>
                    );
                  })()
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="gap-2"
              onClick={refreshAll}
              disabled={
                isFetchingFixedStats ||
                isFetchingSelectedRangeOverview ||
                isFetchingChats ||
                isFetchingMessages
              }
              title={t('adminChats.refresh')}
            >
              <RefreshCw
                className={`h-4 w-4 ${
                  isFetchingFixedStats ||
                  isFetchingSelectedRangeOverview ||
                  isFetchingChats ||
                  isFetchingMessages
                    ? 'animate-spin'
                    : ''
                }`}
              />
              {t('adminChats.refresh')}
            </Button>
            <div className="text-xs text-muted-foreground">{t('adminChats.chatsHint')}</div>
          </div>

          <div
            id="admin-chats-chats-section"
            ref={chatsSectionRef}
            className="rounded-lg border border-border bg-card overflow-hidden scroll-mt-24"
          >
            <div className="p-4 border-b border-border space-y-3">
              <div>
                <div className="text-sm font-semibold">{t('adminChats.chatsTitle')}</div>
                <div className="text-xs text-muted-foreground">{t('adminChats.chatsHint')}</div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="w-full sm:w-72">
                    <div className="text-xs text-muted-foreground mb-1">
                      {t('adminChats.search')}
                    </div>
                    <Input
                      value={chatSearch}
                      onChange={(e) => setChatSearch(e.target.value)}
                      placeholder={t('adminChats.searchPlaceholder')}
                    />
                  </div>

                  <div className="w-full sm:w-52">
                    <div className="text-xs text-muted-foreground mb-1">{t('adminChats.sort')}</div>
                    <select
                      className="h-8 w-full rounded-md border border-input bg-card pl-3 pr-8 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                      value={sortKey}
                      onChange={(e) => setSortKey(e.target.value as any)}
                    >
                      <option value="last_message_time">{t('adminChats.sortLastMessage')}</option>
                      <option value="message_count">{t('adminChats.sortMessageCount')}</option>
                      <option value="flagged_count">{t('adminChats.sortFlaggedCount')}</option>
                      <option value="email">{t('adminChats.sortUserEmail')}</option>
                    </select>
                  </div>

                  <div className="w-full sm:w-36">
                    <div className="text-xs text-muted-foreground mb-1">
                      {t('adminChats.direction')}
                    </div>
                    <select
                      className="h-8 w-full rounded-md border border-input bg-card pl-3 pr-8 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                      value={sortDir}
                      onChange={(e) => setSortDir(e.target.value as any)}
                    >
                      <option value="desc">{t('adminChats.desc')}</option>
                      <option value="asc">{t('adminChats.asc')}</option>
                    </select>
                  </div>

                  <div className="w-full sm:w-auto">
                    <div className="text-xs text-muted-foreground mb-1">&nbsp;</div>
                    <label className="flex h-8 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={flaggedOnly}
                        onChange={(e) => setFlaggedOnly(e.target.checked)}
                      />
                      <span className="text-[13px]">{t('adminChats.flaggedOnly')}</span>
                    </label>
                  </div>

                  <div className="w-full sm:w-64">
                    <div className="text-xs text-muted-foreground mb-1">
                      {t('adminChats.llmFilterLabel')}
                    </div>
                    <select
                      className="h-8 w-full rounded-md border border-input bg-card pl-3 pr-8 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                      value={llmFilterId ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setLlmFilterId(v === '' ? null : Number(v));
                      }}
                    >
                      <option value="">{t('adminChats.llmFilterAll')}</option>
                      {(selectedRangeOverview?.llm_usage ?? [])
                        .filter((r) => r.used_llm_id != null)
                        .map((r) => (
                          <option key={r.used_llm_id} value={r.used_llm_id}>
                            {r.used_llm_name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
            <div className="p-4 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">{t('common.actions')}</TableHead>
                    <TableHead>{t('adminChats.chatTitle')}</TableHead>
                    <TableHead>{t('adminChats.userEmail')}</TableHead>
                    <TableHead className="min-w-[12rem]">{t('adminChats.llmsInChat')}</TableHead>
                    <TableHead className="w-40">{t('adminChats.lastMessage')}</TableHead>
                    <TableHead className="w-28 text-right">
                      {t('adminChats.messageCount')}
                    </TableHead>
                    <TableHead className="w-28 text-right">
                      {t('adminChats.flaggedCount')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isFetchingChats ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-muted-foreground">
                        {t('common.loading')}
                      </TableCell>
                    </TableRow>
                  ) : chats.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-muted-foreground">
                        {t('adminChats.noChats')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    chats.map((c) => {
                      const isSelected = c.chat_id === selectedChatId;
                      return (
                        <TableRow
                          key={c.chat_id}
                          className={`cursor-pointer hover:bg-muted/40 ${isSelected ? 'bg-muted/60' : ''}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => openChatAndScroll(c.chat_id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') openChatAndScroll(c.chat_id);
                          }}
                        >
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="hover:text-green-600"
                              onClick={(e) => {
                                e.stopPropagation();
                                openChatAndScroll(c.chat_id);
                              }}
                              title={t('adminChats.openChat')}
                              aria-label={t('adminChats.openChat')}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TableCell>
                          <TableCell className="whitespace-normal break-words max-w-[22rem]">
                            {(c.title ?? '').trim() || t('adminChats.untitled')}
                          </TableCell>
                          <TableCell className="whitespace-normal break-words max-w-[18rem]">
                            {c.user_email}
                          </TableCell>
                          <TableCell className="align-top py-3">
                            <LlmTiles items={c.llms_used} noneLabel={t('adminChats.noLlmInChat')} />
                          </TableCell>
                          <TableCell>{formatDateTime(c.last_message_time)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {c.message_count}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {c.flagged_count}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <TablePaginationBar
              total={chatTotal}
              from={rangeFrom}
              to={rangeTo}
              pageSize={chatPageSize}
              pageIndex={chatPageIndex}
              pageCount={chatPageCount}
              onPageSizeChange={(next) => {
                setChatPageSize(next);
                setChatPageIndex(0);
              }}
              onPageIndexChange={setChatPageIndex}
              className="px-4 pb-4 pt-0"
            />
          </div>

          <div
            id="admin-chats-messages-section"
            ref={messagesSectionRef}
            className="rounded-lg border border-border bg-card scroll-mt-24"
          >
            <div className="p-4 border-b border-border space-y-3">
              <div>
                <div className="text-sm font-semibold">{t('adminChats.messagesTitle')}</div>
                <div className="text-xs text-muted-foreground">
                  {selectedChat
                    ? t('adminChats.messagesForChat', { email: selectedChat.user_email })
                    : t('adminChats.selectChatHint')}
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="w-full sm:w-72">
                    <div className="text-xs text-muted-foreground mb-1">
                      {t('adminChats.messageSearch')}
                    </div>
                    <Input
                      value={messageSearch}
                      onChange={(e) => setMessageSearch(e.target.value)}
                      placeholder={t('adminChats.messageSearchPlaceholder')}
                      disabled={selectedChatId == null}
                    />
                  </div>

                  <div className="w-full sm:w-44">
                    <div className="text-xs text-muted-foreground mb-1">
                      {t('adminChats.sender')}
                    </div>
                    <select
                      className="h-8 w-full rounded-md border border-input bg-card pl-3 pr-8 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                      value={senderFilter}
                      onChange={(e) => setSenderFilter(e.target.value as any)}
                      disabled={selectedChatId == null}
                    >
                      <option value="all">{t('adminChats.senderAll')}</option>
                      <option value="user">{t('adminChats.senderUser')}</option>
                      <option value="assistant">{t('adminChats.senderAssistant')}</option>
                    </select>
                  </div>

                  <div className="w-full sm:w-44">
                    <div className="text-xs text-muted-foreground mb-1">
                      {t('adminChats.direction')}
                    </div>
                    <select
                      className="h-8 w-full rounded-md border border-input bg-card pl-3 pr-8 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                      value={messagesDir}
                      onChange={(e) => setMessagesDir(e.target.value as any)}
                      disabled={selectedChatId == null}
                    >
                      <option value="asc">{t('adminChats.asc')}</option>
                      <option value="desc">{t('adminChats.desc')}</option>
                    </select>
                  </div>

                  <div className="w-full sm:w-auto">
                    <div className="text-xs text-muted-foreground mb-1">&nbsp;</div>
                    <label className="flex h-8 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={messagesFlaggedOnly}
                        onChange={(e) => setMessagesFlaggedOnly(e.target.checked)}
                        disabled={selectedChatId == null}
                      />
                      <span className="text-[13px]">{t('adminChats.flaggedOnly')}</span>
                    </label>
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <Button
                    variant="outline"
                    onClick={() => void refetchMessages()}
                    disabled={selectedChatId == null}
                  >
                    {t('adminChats.refreshMessages')}
                  </Button>
                </div>
              </div>
            </div>

            <div className="p-4">
              {selectedChatId == null ? (
                <div className="text-sm text-muted-foreground">
                  {t('adminChats.selectChatHint')}
                </div>
              ) : isFetchingMessages ? (
                <div className="text-sm text-muted-foreground">{t('common.loading')}</div>
              ) : filteredMessages.length === 0 ? (
                <div className="text-sm text-muted-foreground">{t('adminChats.noMessages')}</div>
              ) : (
                <div className="space-y-4">
                  {filteredMessages.map((m) => {
                    const flagged = m.is_flagged_by_user;
                    const bubbleBase = m.is_sent_by_user
                      ? 'border border-primary/15 bg-[color:color-mix(in_oklab,var(--primary)_15%,transparent)] text-foreground'
                      : 'bg-card border border-border text-foreground';
                    const bubbleFlagged = flagged
                      ? 'ring-2 ring-destructive/40 border-destructive/40 bg-destructive/5'
                      : '';
                    return (
                      <div
                        key={m.message_id}
                        className={`flex ${m.is_sent_by_user ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[92%] rounded-xl px-4 py-3 text-[14px] ${bubbleBase} ${bubbleFlagged} ${
                            m.is_sent_by_user ? 'whitespace-pre-wrap' : ''
                          }`}
                          data-testid={flagged ? 'flagged-message-bubble' : undefined}
                        >
                          <div
                            className={`text-[12px] text-muted-foreground mb-1.5 ${
                              m.is_sent_by_user ? 'text-right' : 'text-left'
                            }`}
                          >
                            {m.is_sent_by_user
                              ? `${t('adminChats.userLabel')}, ${formatDateTime(m.sent_time)}`
                              : `${m.used_llm_name ?? (m.used_llm_id != null ? `LLM ${m.used_llm_id}` : t('adminChats.unknownLlm'))}, ${formatDateTime(m.sent_time)}`}
                          </div>
                          {m.is_sent_by_user ? (
                            m.encrypted_content
                          ) : (
                            <ChatAssistantContent
                              thinkingLabel={t('chat.thinking')}
                              content={m.encrypted_content}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {tileModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            aria-label={t('common.cancel')}
            onClick={cancelTimeframeModal}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-lg border border-border bg-card shadow-lg text-card-foreground flex flex-col"
          >
            <div className="shrink-0 px-5 py-4 border-b border-border">
              <div className="text-[15px] font-semibold">{t('adminChats.timeframe')}</div>
              <div className="text-[13px] text-muted-foreground">
                {t('adminChats.messagesInRange')}
              </div>
            </div>
            <div className="px-5 py-5 overflow-y-auto">
              <div>
                <AdminDateRangePicker
                  preset={draftPreset}
                  from={draftFromYmd}
                  to={draftToYmd}
                  onPresetChange={setDraftPreset}
                  onFromChange={(v) => {
                    setDraftPreset('custom');
                    setDraftFromYmd(v);
                  }}
                  onToChange={(v) => {
                    setDraftPreset('custom');
                    setDraftToYmd(v);
                  }}
                  onApplyPresetRange={() => {}}
                  autoApplyPreset={false}
                  showApplyButton={false}
                />
              </div>
            </div>

            <div className="shrink-0 border-t border-border bg-card/95 backdrop-blur-sm p-4 flex justify-end gap-2">
              <Button variant="outline" onClick={cancelTimeframeModal}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={saveTimeframeModal}
                disabled={draftPreset === 'custom' && (!draftFromYmd || !draftToYmd)}
              >
                {t('common.save')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
