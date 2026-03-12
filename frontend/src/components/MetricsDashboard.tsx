"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import {
  getMetricsSummary,
  getMetricsTimeseries,
  getMetricsBreakdown,
  getMetricsPipeline,
  getRealtimeMetrics,
  getMetrics,
  type MetricsSummary,
  type TimeseriesPoint,
  type BreakdownItem,
  type PipelineData,
  type RealtimeMetrics,
  type MetricsData,
} from "@/lib/api";

// ── Color palette matching the app theme ──
const COLORS = {
  sage: "var(--color-sage)",
  gold: "var(--color-gold)",
  blue: "#60a5fa",
  red: "#f87171",
  purple: "#a78bfa",
  teal: "#2dd4bf",
  orange: "#fb923c",
  pink: "#f472b6",
};
const CHART_COLORS = [COLORS.sage, COLORS.blue, COLORS.gold, COLORS.purple, COLORS.teal, COLORS.orange, COLORS.red, COLORS.pink];

type Period = "today" | "7d" | "30d" | "90d";

const PERIOD_LABELS: Record<Period, string> = {
  today: "Today",
  "7d": "7 Days",
  "30d": "30 Days",
  "90d": "90 Days",
};

// ── Formatting helpers ──
function fmtCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function fmtNum(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function fmtDate(d: string): string {
  // "2026-03-11" -> "3/11"
  const parts = d.split("-");
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
}

// ── Skeleton loader ──
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-surface-300 rounded ${className}`} />;
}

// ── Main Dashboard ──
export default function MetricsDashboard() {
  const [period, setPeriod] = useState<Period>("30d");
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [realtime, setRealtime] = useState<RealtimeMetrics | null>(null);
  const [costSeries, setCostSeries] = useState<TimeseriesPoint[] | null>(null);
  const [tokenSeries, setTokenSeries] = useState<TimeseriesPoint[] | null>(null);
  const [dauSeries, setDauSeries] = useState<TimeseriesPoint[] | null>(null);
  const [querySeries, setQuerySeries] = useState<TimeseriesPoint[] | null>(null);
  const [latencySeries, setLatencySeries] = useState<TimeseriesPoint[] | null>(null);
  const [tokenBreakdown, setTokenBreakdown] = useState<BreakdownItem[] | null>(null);
  const [costBreakdown, setCostBreakdown] = useState<BreakdownItem[] | null>(null);
  const [pipeline, setPipeline] = useState<PipelineData | null>(null);
  const [legacyMetrics, setLegacyMetrics] = useState<MetricsData | null>(null);
  const [chartMode, setChartMode] = useState<"cost" | "tokens">("cost");
  const [breakdownTab, setBreakdownTab] = useState<"role" | "model">("role");
  const [modelTokenBreakdown, setModelTokenBreakdown] = useState<BreakdownItem[] | null>(null);
  const [modelCostBreakdown, setModelCostBreakdown] = useState<BreakdownItem[] | null>(null);

  const loadData = useCallback(async () => {
    // Reset to show skeletons
    setSummary(null);
    setCostSeries(null);
    setTokenSeries(null);
    setDauSeries(null);
    setQuerySeries(null);
    setLatencySeries(null);
    setTokenBreakdown(null);
    setCostBreakdown(null);
    setModelTokenBreakdown(null);
    setModelCostBreakdown(null);
    setPipeline(null);

    // Parallel fetch all data
    const results = await Promise.allSettled([
      getMetricsSummary(period),
      getMetricsTimeseries("cost", period),
      getMetricsTimeseries("tokens", period),
      getMetricsTimeseries("dau", period),
      getMetricsTimeseries("queries", period),
      getMetricsTimeseries("latency", period),
      getMetricsBreakdown("tokens", period),
      getMetricsBreakdown("cost", period),
      getMetricsPipeline(period),
      getRealtimeMetrics(),
      getMetrics(),
      getMetricsBreakdown("tokens", period, "model"),
      getMetricsBreakdown("cost", period, "model"),
    ]);

    if (results[0].status === "fulfilled") setSummary(results[0].value);
    if (results[1].status === "fulfilled") setCostSeries(results[1].value);
    if (results[2].status === "fulfilled") setTokenSeries(results[2].value);
    if (results[3].status === "fulfilled") setDauSeries(results[3].value);
    if (results[4].status === "fulfilled") setQuerySeries(results[4].value);
    if (results[5].status === "fulfilled") setLatencySeries(results[5].value);
    if (results[6].status === "fulfilled") setTokenBreakdown(results[6].value);
    if (results[7].status === "fulfilled") setCostBreakdown(results[7].value);
    if (results[8].status === "fulfilled") setPipeline(results[8].value);
    if (results[9].status === "fulfilled") setRealtime(results[9].value);
    if (results[10].status === "fulfilled") setLegacyMetrics(results[10].value);
    if (results[11].status === "fulfilled") setModelTokenBreakdown(results[11].value);
    if (results[12].status === "fulfilled") setModelCostBreakdown(results[12].value);
  }, [period]);

  useEffect(() => { loadData(); }, [loadData]);

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text-900">Metrics Dashboard</h2>
        <div className="flex gap-1 bg-surface-100 border border-surface-300 rounded-lg p-0.5">
          {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                period === p
                  ? "bg-sage text-white"
                  : "text-text-600 hover:text-text-800 hover:bg-surface-200"
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Section 1: KPI Cards */}
      <KPICards summary={summary} realtime={realtime} />

      {/* Section 2: Cost & Token Time Series */}
      <div className="bg-surface-200 border border-surface-300 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs text-text-500 uppercase tracking-wide">
            {chartMode === "cost" ? "Daily Cost" : "Daily Tokens"} — {PERIOD_LABELS[period]}
          </h3>
          <div className="flex gap-1">
            {(["cost", "tokens"] as const).map(m => (
              <button
                key={m}
                onClick={() => setChartMode(m)}
                className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                  chartMode === m ? "bg-sage text-white" : "text-text-500 hover:bg-surface-300"
                }`}
              >
                {m === "cost" ? "Cost ($)" : "Tokens"}
              </button>
            ))}
          </div>
        </div>
        {chartMode === "cost" ? (
          <TimeSeriesChart data={costSeries} valueKey="sum_value" formatter={fmtCost} color={COLORS.red} />
        ) : (
          <TimeSeriesChart data={tokenSeries} valueKey="sum_value" formatter={fmtTokens} color={COLORS.blue} />
        )}
      </div>

      {/* Section 3: Usage Breakdown */}
      <div>
        <div className="flex gap-1 mb-3">
          {(["role", "model"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setBreakdownTab(tab)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                breakdownTab === tab
                  ? "bg-sage text-white"
                  : "text-text-600 hover:text-text-800 hover:bg-surface-200"
              }`}
            >
              By {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-surface-200 border border-surface-300 rounded-xl p-4">
            <h3 className="text-xs text-text-500 uppercase tracking-wide mb-3">
              Tokens by {breakdownTab === "role" ? "Role" : "Model"}
            </h3>
            <BreakdownBarChart
              data={breakdownTab === "role" ? tokenBreakdown : modelTokenBreakdown}
              valueKey="total_value"
              formatter={fmtTokens}
            />
          </div>
          <div className="bg-surface-200 border border-surface-300 rounded-xl p-4">
            <h3 className="text-xs text-text-500 uppercase tracking-wide mb-3">
              Cost by {breakdownTab === "role" ? "Role" : "Model"}
            </h3>
            <BreakdownBarChart
              data={breakdownTab === "role" ? costBreakdown : modelCostBreakdown}
              valueKey="total_value"
              formatter={fmtCost}
            />
          </div>
        </div>
      </div>

      {/* Section 4: Pipeline & Tool Metrics */}
      {pipeline && (pipeline.agent_calls.length > 0 || pipeline.tool_calls.length > 0) && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pipeline.agent_calls.length > 0 && (
              <div className="bg-surface-200 border border-surface-300 rounded-xl p-4">
                <h3 className="text-xs text-text-500 uppercase tracking-wide mb-3">Top Agents</h3>
                <BreakdownBarChart
                  data={pipeline.agent_calls.map(a => ({ dimension: a.event_name, total_count: a.count, total_value: a.count, avg_value: 0 }))}
                  valueKey="total_count"
                  formatter={fmtNum}
                />
              </div>
            )}
            {pipeline.tool_calls.length > 0 && (
              <div className="bg-surface-200 border border-surface-300 rounded-xl p-4">
                <h3 className="text-xs text-text-500 uppercase tracking-wide mb-3">Tool Calls</h3>
                <div className="border border-surface-300 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-surface-300">
                        <th className="text-left px-3 py-1.5 text-[11px] text-text-600 font-medium">Tool</th>
                        <th className="text-right px-3 py-1.5 text-[11px] text-text-600 font-medium">Calls</th>
                        <th className="text-right px-3 py-1.5 text-[11px] text-text-600 font-medium">Avg ms</th>
                        <th className="text-right px-3 py-1.5 text-[11px] text-text-600 font-medium">Success</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pipeline.tool_calls.slice(0, 10).map(t => (
                        <tr key={t.event_name} className="border-t border-surface-300">
                          <td className="px-3 py-1.5 text-text-800 text-xs font-medium truncate max-w-[120px]">{t.event_name}</td>
                          <td className="px-3 py-1.5 text-text-600 text-xs text-right">{t.count}</td>
                          <td className="px-3 py-1.5 text-text-600 text-xs text-right">{Math.round(t.avg_duration_ms)}</td>
                          <td className="px-3 py-1.5 text-text-600 text-xs text-right">{(t.success_rate * 100).toFixed(0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Section 5: User Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface-200 border border-surface-300 rounded-xl p-4">
          <h3 className="text-xs text-text-500 uppercase tracking-wide mb-3">DAU — {PERIOD_LABELS[period]}</h3>
          <TimeSeriesChart data={dauSeries} valueKey="count" formatter={fmtNum} color={COLORS.sage} />
        </div>
        <div className="bg-surface-200 border border-surface-300 rounded-xl p-4">
          <h3 className="text-xs text-text-500 uppercase tracking-wide mb-3">Queries — {PERIOD_LABELS[period]}</h3>
          <TimeSeriesChart data={querySeries} valueKey="count" formatter={fmtNum} color={COLORS.gold} />
        </div>
      </div>

      {/* Latency chart */}
      <div className="bg-surface-200 border border-surface-300 rounded-xl p-4">
        <h3 className="text-xs text-text-500 uppercase tracking-wide mb-3">Avg Latency (ms) — {PERIOD_LABELS[period]}</h3>
        <TimeSeriesChart data={latencySeries} valueKey="avg_value" formatter={(n) => `${Math.round(n)}ms`} color={COLORS.purple} />
      </div>

      {/* Tier breakdown from legacy endpoint */}
      {legacyMetrics && (
        <div className="bg-surface-200 border border-surface-300 rounded-xl p-4">
          <h3 className="text-xs text-text-500 uppercase tracking-wide mb-3">Tier Breakdown</h3>
          <TierBar breakdown={legacyMetrics.tier_breakdown} total={legacyMetrics.total_users} />
        </div>
      )}
    </div>
  );
}

// ── KPI Summary Cards ──
function KPICards({ summary, realtime }: { summary: MetricsSummary | null; realtime: RealtimeMetrics | null }) {
  const cards = useMemo(() => {
    if (!summary) return null;
    return [
      { label: "Total Cost", value: fmtCost(summary.total_cost) },
      { label: "Total Tokens", value: fmtTokens(summary.total_tokens) },
      { label: "Total Queries", value: fmtNum(summary.total_queries) },
      { label: "Avg DAU", value: fmtNum(summary.avg_dau) },
      { label: "Avg Latency", value: `${Math.round(summary.avg_latency)}ms` },
      { label: "LLM Calls", value: fmtNum(summary.total_llm_calls) },
    ];
  }, [summary]);

  if (!cards) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-surface-200 border border-surface-300 rounded-xl p-4">
            <Skeleton className="h-3 w-16 mb-2" />
            <Skeleton className="h-7 w-20" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map(c => (
        <div key={c.label} className="bg-surface-200 border border-surface-300 rounded-xl p-4">
          <p className="text-[11px] text-text-500 uppercase tracking-wide">{c.label}</p>
          <p className="text-xl font-bold text-text-900 mt-1">{c.value}</p>
        </div>
      ))}
      {/* Realtime indicator */}
      {realtime && (
        <div className="col-span-2 md:col-span-3 lg:col-span-6 flex gap-4 text-[11px] text-text-500 bg-surface-100 border border-surface-300 rounded-lg px-3 py-1.5">
          <span>Live today: {realtime.llm_calls} calls</span>
          <span>{fmtTokens(realtime.tokens)} tokens</span>
          <span>{fmtCost(realtime.cost_usd)}</span>
          <span>{realtime.dau} active users</span>
          <span>{Math.round(realtime.avg_latency_ms)}ms avg</span>
        </div>
      )}
    </div>
  );
}

// ── Time Series Chart ──
function TimeSeriesChart({
  data,
  valueKey,
  formatter,
  color,
}: {
  data: TimeseriesPoint[] | null;
  valueKey: keyof TimeseriesPoint;
  formatter: (n: number) => string;
  color: string;
}) {
  if (!data) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (data.length === 0) {
    return <p className="text-sm text-text-500 text-center py-12">No data for this period.</p>;
  }

  const chartData = data.map(d => ({
    date: fmtDate(d.date),
    value: Number(d[valueKey]) || 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-300)" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--color-text-500)" }} />
        <YAxis tick={{ fontSize: 11, fill: "var(--color-text-500)" }} tickFormatter={formatter} width={50} />
        <Tooltip
          contentStyle={{ backgroundColor: "var(--color-surface-100)", border: "1px solid var(--color-surface-300)", borderRadius: 8, fontSize: 12 }}
          formatter={(value) => [formatter(Number(value ?? 0)), ""]}
          labelStyle={{ color: "var(--color-text-700)" }}
        />
        <defs>
          <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="value" stroke={color} fill={`url(#grad-${color})`} strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Breakdown Bar Chart ──
function BreakdownBarChart({
  data,
  valueKey,
  formatter,
}: {
  data: BreakdownItem[] | { dimension: string; total_count: number; total_value: number; avg_value: number }[] | null;
  valueKey: "total_count" | "total_value";
  formatter: (n: number) => string;
}) {
  if (!data) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (data.length === 0) {
    return <p className="text-sm text-text-500 text-center py-12">No data.</p>;
  }

  // Filter out model: prefix for cleaner labels
  const chartData = data.slice(0, 8).map(d => ({
    name: d.dimension.replace("model:", ""),
    value: Number(d[valueKey]) || 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-300)" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: "var(--color-text-500)" }} tickFormatter={formatter} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "var(--color-text-700)" }} width={80} />
        <Tooltip
          contentStyle={{ backgroundColor: "var(--color-surface-100)", border: "1px solid var(--color-surface-300)", borderRadius: 8, fontSize: 12 }}
          formatter={(value) => [formatter(Number(value ?? 0)), ""]}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {chartData.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Tier Breakdown Bar (kept from original) ──
function TierBar({ breakdown, total }: { breakdown: { free: number; free_promo: number; pro: number }; total: number }) {
  if (total === 0) return <p className="text-sm text-text-500">No users yet.</p>;
  const pct = (n: number) => Math.max((n / total) * 100, n > 0 ? 3 : 0);
  const segments = [
    { label: "Community", count: breakdown.free, bg: "bg-surface-400" },
    { label: "Community+", count: breakdown.free_promo, bg: "bg-amber-400" },
    { label: "Sponsor", count: breakdown.pro, bg: "bg-sage" },
  ];
  return (
    <div>
      <div className="flex rounded-lg overflow-hidden h-6">
        {segments.map(s => s.count > 0 && (
          <div
            key={s.label}
            className={`${s.bg} flex items-center justify-center text-[10px] font-medium text-white`}
            style={{ width: `${pct(s.count)}%` }}
          >
            {s.count}
          </div>
        ))}
      </div>
      <div className="flex gap-4 mt-2">
        {segments.map(s => (
          <div key={s.label} className="flex items-center gap-1.5 text-xs text-text-600">
            <div className={`w-2.5 h-2.5 rounded-sm ${s.bg}`} />
            {s.label}: {s.count}
          </div>
        ))}
      </div>
    </div>
  );
}
