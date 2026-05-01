"use client";

import Image from "next/image";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Clock,
  Flame,
  LayoutDashboard,
  Map,
  Menu,
  PlayCircle,
  Users,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/lib/supabase";

type ZoneStat = {
  name: string;
  AvgDwell: number;
  Visits: number;
  TotalDwell: number;
};

type DwellLog = {
  zone_id: string | null;
  dwell_seconds: number | null;
  enter_time: string | null;
  zones?: { name?: string } | { name?: string }[] | null;
};

type SimZone = {
  name: string;
  top: string;
  left: string;
  width: string;
  height: string;
  tint: string;
};

const DEFAULT_CAMERA = "camera_1";
const HEAT_COLORS = ["#ef4444", "#f97316", "#f59e0b", "#22c55e"];
const SIM_ZONES: SimZone[] = [
  { name: "Zone_1", top: "10%", left: "8%", width: "26%", height: "30%", tint: "bg-sky-500/15 border-sky-400" },
  { name: "Zone_2", top: "18%", left: "38%", width: "26%", height: "26%", tint: "bg-violet-500/15 border-violet-400" },
  { name: "Zone_3", top: "12%", left: "70%", width: "18%", height: "34%", tint: "bg-amber-500/15 border-amber-400" },
  { name: "Zone_4", top: "58%", left: "18%", width: "26%", height: "22%", tint: "bg-emerald-500/15 border-emerald-400" },
  { name: "Zone_5", top: "56%", left: "54%", width: "28%", height: "24%", tint: "bg-rose-500/15 border-rose-400" },
];

const formatSeconds = (value: number) => `${Math.round(value)} 秒`;
const toZoneName = (zones: DwellLog["zones"]) =>
  (Array.isArray(zones) ? zones[0]?.name : zones?.name) || "Unknown";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [totalVisitors, setTotalVisitors] = useState(0);
  const [avgDwell, setAvgDwell] = useState(0);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [zoneStats, setZoneStats] = useState<ZoneStat[]>([]);
  const [dwellLogs, setDwellLogs] = useState<DwellLog[]>([]);
  const [assetVersion, setAssetVersion] = useState(() => Date.now());

  const fetchOverviewData = useCallback(async () => {
    try {
      setFetchError(null);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const { data: sessions, error: sessionError } = await supabase
        .from("customer_sessions")
        .select("*")
        .gte("start_time", today.toISOString());

      if (sessionError) {
        setFetchError(`sessions: ${sessionError.message}`);
      }

      if (sessions && sessions.length > 0) {
        setTotalVisitors(sessions.length);
      } else {
        const { data: fallbackSessions } = await supabase
          .from("customer_sessions")
          .select("*")
          .limit(100);
        setTotalVisitors(fallbackSessions?.length || 0);
      }

      const { data: logsToday, error: dwellError } = await supabase
        .from("dwell_logs")
        .select("zone_id, dwell_seconds, enter_time, zones(name)")
        .gte("enter_time", today.toISOString())
        .lt("enter_time", tomorrow.toISOString());

      if (dwellError) {
        setFetchError((current) =>
          current ? `${current} | dwellLogs: ${dwellError.message}` : `dwellLogs: ${dwellError.message}`
        );
      }

      const sourceLogs =
        logsToday && logsToday.length > 0
          ? (logsToday as DwellLog[])
          : (((await supabase
              .from("dwell_logs")
              .select("zone_id, dwell_seconds, enter_time, zones(name)")
              .limit(200)).data as DwellLog[]) || []);

      setDwellLogs(sourceLogs);

      if (sourceLogs.length === 0) {
        setZoneStats([]);
        setAvgDwell(0);
        setAssetVersion(Date.now());
        return;
      }

      let totalTime = 0;
      const zoneMap: Record<string, ZoneStat> = {};

      sourceLogs.forEach((log) => {
        const dwell = log.dwell_seconds || 0;
        const zoneName = toZoneName(log.zones);
        totalTime += dwell;

        if (!zoneMap[zoneName]) {
          zoneMap[zoneName] = {
            name: zoneName,
            AvgDwell: 0,
            Visits: 0,
            TotalDwell: 0,
          };
        }

        zoneMap[zoneName].Visits += 1;
        zoneMap[zoneName].TotalDwell += dwell;
      });

      const stats = Object.values(zoneMap)
        .map((zone) => ({
          ...zone,
          AvgDwell: Math.round(zone.TotalDwell / Math.max(zone.Visits, 1)),
        }))
        .sort((a, b) => b.Visits - a.Visits);

      setAvgDwell(totalTime / sourceLogs.length);
      setZoneStats(stats);
      setAssetVersion(Date.now());
    } catch (err) {
      setFetchError((err as Error)?.message || String(err));
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void fetchOverviewData();
    }, 0);

    const channel = supabase
      .channel("schema-db-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "customer_sessions" },
        () => {
          void fetchOverviewData();
        }
      )
      .subscribe();

    return () => {
      window.clearTimeout(initialLoad);
      supabase.removeChannel(channel);
    };
  }, [fetchOverviewData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setAssetVersion(Date.now());
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  const totalZoneVisits = useMemo(
    () => zoneStats.reduce((sum, zone) => sum + zone.Visits, 0),
    [zoneStats]
  );

  const totalZoneDwell = useMemo(
    () => zoneStats.reduce((sum, zone) => sum + zone.TotalDwell, 0),
    [zoneStats]
  );

  const hottestZone = zoneStats[0];
  const longestDwellZone = useMemo(
    () => [...zoneStats].sort((a, b) => b.AvgDwell - a.AvgDwell)[0],
    [zoneStats]
  );

  const dwellBands = useMemo(() => {
    const counts = { quick: 0, browse: 0, engage: 0, deep: 0 };

    dwellLogs.forEach((log) => {
      const dwell = log.dwell_seconds || 0;
      if (dwell < 30) counts.quick += 1;
      else if (dwell < 90) counts.browse += 1;
      else if (dwell < 180) counts.engage += 1;
      else counts.deep += 1;
    });

    return [
      { label: "快速經過", range: "< 30 秒", value: counts.quick, color: "#cbd5e1" },
      { label: "短暫瀏覽", range: "30-89 秒", value: counts.browse, color: "#60a5fa" },
      { label: "重點停留", range: "90-179 秒", value: counts.engage, color: "#a78bfa" },
      { label: "深度互動", range: "180+ 秒", value: counts.deep, color: "#f97316" },
    ];
  }, [dwellLogs]);

  const dwellTimeline = useMemo(() => {
    const buckets = [
      { label: "09-12", start: 9, end: 12, value: 0 },
      { label: "12-15", start: 12, end: 15, value: 0 },
      { label: "15-18", start: 15, end: 18, value: 0 },
      { label: "18-21", start: 18, end: 21, value: 0 },
    ];

    dwellLogs.forEach((log) => {
      if (!log.enter_time) return;
      const hour = new Date(log.enter_time).getHours();
      const bucket = buckets.find((item) => hour >= item.start && hour < item.end);
      if (bucket) bucket.value += log.dwell_seconds || 0;
    });

    return buckets.map(({ label, value }) => ({
      label,
      minutes: Math.round(value / 60),
    }));
  }, [dwellLogs]);

  const flaggedZones = useMemo(
    () =>
      [...zoneStats]
        .sort((a, b) => b.AvgDwell - a.AvgDwell)
        .slice(0, 3)
        .map((zone) => ({
          ...zone,
          status:
            zone.AvgDwell >= 180
              ? "停留過長，建議檢查動線或補貨"
              : zone.AvgDwell >= 90
                ? "互動表現佳，可加強導購轉換"
                : "停留偏短，適合優化陳列吸引力",
        })),
    [zoneStats]
  );

  const simulatedZones = useMemo(
    () =>
      SIM_ZONES.map((zone, index) => {
        const stat = zoneStats.find((item) => item.name === zone.name) || zoneStats[index] || null;
        return {
          ...zone,
          visits: stat?.Visits || 0,
          avgDwell: stat?.AvgDwell || 0,
          totalDwell: stat?.TotalDwell || 0,
          heatPercent: hottestZone ? Math.round(((stat?.Visits || 0) / Math.max(hottestZone.Visits, 1)) * 100) : 0,
        };
      }),
    [zoneStats, hottestZone]
  );

  const trajectoryStops = useMemo(
    () =>
      zoneStats.slice(0, 4).map((zone, index) => ({
        zone,
        top: ["24%", "38%", "29%", "60%"][index] || "50%",
        left: ["16%", "42%", "69%", "34%"][index] || "52%",
      })),
    [zoneStats]
  );

  const trajectoryVideoSrc = `/api/analytics/tracking?camera=${DEFAULT_CAMERA}`;
  const heatmapImageSrc = `/api/analytics/heatmap?camera=${DEFAULT_CAMERA}&v=${assetVersion}`;

  const renderContent = () => {
    switch (activeTab) {
      case "overview":
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800 tracking-tight">商場感知儀表板</h2>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <MetricCard icon={<Users size={28} />} iconClassName="bg-blue-50 text-blue-600" label="今日進客數" value={String(totalVisitors)} />
              <MetricCard
                icon={<Clock size={28} />}
                iconClassName="bg-emerald-50 text-emerald-600"
                label="平均停留時間"
                value={avgDwell > 0 ? avgDwell.toFixed(1) : "0.0"}
                suffix="秒"
              />
              <MetricCard
                icon={<Activity size={28} />}
                iconClassName="bg-purple-50 text-purple-600"
                label="系統狀態"
                value="線上 / 即時同步中"
                valueClassName="text-lg text-emerald-500"
              />
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_0.95fr]">
              <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <h3 className="mb-6 text-lg font-bold text-gray-800">各區域造訪人次</h3>
                <ResponsiveContainer width="100%" height={340}>
                  <BarChart data={zoneStats}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#6B7280" }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "#6B7280" }} />
                    <RechartsTooltip
                      cursor={{ fill: "#F3F4F6" }}
                      contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                    />
                    <Bar dataKey="Visits" radius={[6, 6, 0, 0]}>
                      {zoneStats.map((_, index) => (
                        <Cell key={index} fill={index === 0 ? "#2563eb" : "#93c5fd"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <h3 className="mb-5 text-lg font-bold text-gray-800">即時重點摘要</h3>
                <div className="space-y-4">
                  <InsightRow title="最高熱區" value={hottestZone?.name || "尚無資料"} detail={hottestZone ? `${hottestZone.Visits} 次進入` : "等待同步"} accent="text-red-500" />
                  <InsightRow
                    title="最長停留區"
                    value={longestDwellZone?.name || "尚無資料"}
                    detail={longestDwellZone ? `平均 ${formatSeconds(longestDwellZone.AvgDwell)}` : "等待同步"}
                    accent="text-violet-500"
                  />
                  <InsightRow title="總停留累積" value={formatSeconds(totalZoneDwell)} detail={`${totalZoneVisits} 筆區域紀錄`} accent="text-emerald-500" />
                </div>
              </div>
            </div>
          </div>
        );

      case "trajectories":
        return (
          <div className="space-y-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-800 tracking-tight">移動軌跡分析</h2>
                <p className="mt-1 text-sm text-gray-500">先用模擬動線面板講清楚分析重點，再用真實追蹤影片當佐證，不讓介面只剩媒體預覽。</p>
              </div>
              <div className="rounded-full bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700">模擬分析 + 真實影片</div>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_1fr]">
              <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">模擬動線視圖</h3>
                    <p className="mt-1 text-sm text-gray-500">用站點節點和流向提示，把顧客移動邏輯先講給人看。</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Flow Simulation</span>
                </div>

                <div className="relative aspect-[16/10] overflow-hidden rounded-xl border border-slate-200 bg-[linear-gradient(135deg,#f8fafc,#eef2ff)]">
                  <div className="absolute inset-6 rounded-[20px] border border-dashed border-slate-300" />
                  <div className="absolute left-[12%] top-[16%] h-[58%] w-[8%] rounded-full bg-slate-300/50" />
                  <div className="absolute left-[42%] top-[10%] h-[70%] w-[7%] rounded-full bg-slate-300/40" />
                  <div className="absolute left-[70%] top-[20%] h-[52%] w-[8%] rounded-full bg-slate-300/50" />

                  <svg className="absolute inset-0 h-full w-full">
                    {trajectoryStops.slice(0, -1).map((stop, index) => {
                      const next = trajectoryStops[index + 1];
                      if (!next) return null;
                      return (
                        <line
                          key={stop.zone.name}
                          x1={stop.left}
                          y1={stop.top}
                          x2={next.left}
                          y2={next.top}
                          stroke="#2563eb"
                          strokeWidth="4"
                          strokeDasharray="10 10"
                          opacity="0.75"
                        />
                      );
                    })}
                  </svg>

                  {trajectoryStops.map((stop, index) => (
                    <div
                      key={stop.zone.name}
                      className="absolute -translate-x-1/2 -translate-y-1/2"
                      style={{ top: stop.top, left: stop.left }}
                    >
                      <div className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-white bg-blue-600 text-lg font-bold text-white shadow-lg">
                        {index + 1}
                      </div>
                      <div className="mt-2 min-w-[110px] rounded-xl border border-blue-100 bg-white/95 px-3 py-2 text-center shadow-sm">
                        <p className="text-sm font-semibold text-slate-900">{stop.zone.name}</p>
                        <p className="text-xs text-slate-500">{stop.zone.Visits} 次經過</p>
                      </div>
                    </div>
                  ))}

                  <div className="absolute bottom-4 right-4 rounded-xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
                    <p className="text-xs font-semibold text-slate-500">主動線判讀</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {trajectoryStops.map((stop) => stop.zone.name).join(" -> ") || "等待資料"}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <MiniStat label="主要進入點" value={trajectoryStops[0]?.zone.name || "待同步"} />
                  <MiniStat label="主停留節點" value={hottestZone?.name || "待同步"} />
                  <MiniStat label="平均停留" value={hottestZone ? formatSeconds(hottestZone.AvgDwell) : "待同步"} />
                </div>
              </section>

              <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">真實追蹤回放</h3>
                    <p className="mt-1 text-sm text-gray-500">保留實際輸出，讓模擬分析有可以對照的原始依據。</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Recorded Output</span>
                </div>

                <div className="relative overflow-hidden rounded-xl bg-slate-950">
                  <video className="aspect-video w-full" src={trajectoryVideoSrc} controls muted playsInline />
                  <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-xs font-medium text-white">
                    <PlayCircle size={14} />
                    Camera 1 Tracking Playback
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {zoneStats.slice(0, 3).map((zone, index) => (
                    <div key={zone.name} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm text-gray-500">站點 {index + 1}</p>
                          <p className="font-semibold text-gray-900">{zone.name}</p>
                        </div>
                        <div className="text-right text-sm">
                          <p className="font-semibold text-gray-900">{zone.Visits} 次經過</p>
                          <p className="text-gray-500">平均 {formatSeconds(zone.AvgDwell)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {zoneStats.length === 0 && <EmptyState label="等待軌跡統計資料同步..." />}
                </div>
              </section>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
              <h3 className="mb-6 text-lg font-bold text-gray-800">軌跡統計</h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-gray-200 text-sm text-gray-500">
                      <th className="pb-3 font-medium">區域</th>
                      <th className="pb-3 font-medium">動線熱度</th>
                      <th className="pb-3 font-medium">累計停留時間</th>
                      <th className="pb-3 font-medium">平均每次停留</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zoneStats.map((zone) => (
                      <tr key={zone.name} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-4 font-medium text-gray-800">{zone.name}</td>
                        <td className="py-4 text-gray-600">{((zone.Visits / Math.max(totalZoneVisits, 1)) * 100).toFixed(1)}%</td>
                        <td className="py-4 text-gray-600">{formatSeconds(zone.TotalDwell)}</td>
                        <td className="py-4 text-gray-600">{formatSeconds(zone.AvgDwell)}</td>
                      </tr>
                    ))}
                    {zoneStats.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-gray-500">等待數據載入中...</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );

      case "dwell":
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-800 tracking-tight">停留時間分析</h2>
              <p className="mt-1 text-sm text-gray-500">聚焦停留深度、時段分佈與需要關注的區域，和總覽維持明顯區隔。</p>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
              {dwellBands.map((band) => (
                <div key={band.label} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                  <p className="text-sm font-medium text-gray-500">{band.label}</p>
                  <p className="mt-3 text-3xl font-bold text-gray-900">{band.value}</p>
                  <p className="mt-1 text-sm text-gray-500">{band.range}</p>
                  <div className="mt-4 h-2 rounded-full" style={{ backgroundColor: band.color }} />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <h3 className="mb-6 text-lg font-bold text-gray-800">各時段累積停留分鐘數</h3>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={dwellTimeline}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#6B7280" }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "#6B7280" }} />
                    <RechartsTooltip
                      cursor={{ fill: "#F3F4F6" }}
                      contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                    />
                    <Bar dataKey="minutes" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <h3 className="mb-5 text-lg font-bold text-gray-800">需要關注的區域</h3>
                <div className="space-y-4">
                  {flaggedZones.map((zone) => (
                    <div key={zone.name} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-gray-900">{zone.name}</p>
                          <p className="mt-1 text-sm text-gray-500">{zone.status}</p>
                        </div>
                        <div className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">
                          {formatSeconds(zone.AvgDwell)}
                        </div>
                      </div>
                    </div>
                  ))}
                  {flaggedZones.length === 0 && <EmptyState label="目前還沒有可判讀的停留異常。" />}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
              <h3 className="mb-6 text-lg font-bold text-gray-800">區域停留效率表</h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-gray-200 text-sm text-gray-500">
                      <th className="pb-3 font-medium">區域名稱</th>
                      <th className="pb-3 font-medium">造訪人次</th>
                      <th className="pb-3 font-medium">平均停留秒數</th>
                      <th className="pb-3 font-medium">停留深度</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zoneStats.map((zone) => (
                      <tr key={zone.name} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-4 font-medium text-gray-800">{zone.name}</td>
                        <td className="py-4 text-gray-600">{zone.Visits}</td>
                        <td className="py-4 text-gray-600">{formatSeconds(zone.AvgDwell)}</td>
                        <td className="py-4 text-gray-600">
                          {zone.AvgDwell >= 180 ? "深度停留" : zone.AvgDwell >= 90 ? "高互動" : zone.AvgDwell >= 30 ? "一般瀏覽" : "快速經過"}
                        </td>
                      </tr>
                    ))}
                    {zoneStats.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-gray-500">等待數據載入中...</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );

      case "heatmap":
        return (
          <div className="space-y-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-800 tracking-tight">檢視熱力圖</h2>
                <p className="mt-1 text-sm text-gray-500">先用模擬熱區平面圖傳達熱度差異，再讓真實熱力圖影像輔助驗證。</p>
              </div>
              <div className="rounded-full bg-red-50 px-4 py-2 text-sm font-medium text-red-600">模擬熱區 + 真實影像</div>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_1fr]">
              <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">模擬熱區平面圖</h3>
                    <p className="mt-1 text-sm text-gray-500">將各區域熱度映射到平面配置，讓觀看者先讀懂空間分佈。</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Heat Simulation</span>
                </div>

                <div className="relative aspect-[16/10] overflow-hidden rounded-xl border border-slate-200 bg-[radial-gradient(circle_at_top,#fff7ed,#f8fafc_58%)] p-5">
                  <div className="absolute inset-5 rounded-[24px] border border-dashed border-slate-300" />
                  {simulatedZones.map((zone, index) => {
                    const intensity = Math.max(zone.heatPercent, 10);
                    const glow = HEAT_COLORS[Math.min(index, HEAT_COLORS.length - 1)];
                    return (
                      <div
                        key={zone.name}
                        className={`absolute overflow-hidden rounded-2xl border backdrop-blur-sm ${zone.tint}`}
                        style={{
                          top: zone.top,
                          left: zone.left,
                          width: zone.width,
                          height: zone.height,
                          boxShadow: `0 0 ${Math.round(intensity / 3)}px ${glow}55`,
                        }}
                      >
                        <div className="flex h-full flex-col justify-between p-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{zone.name}</p>
                            <p className="text-xs text-slate-600">{zone.visits} 次進入</p>
                          </div>
                          <div className="rounded-xl bg-white/80 px-2 py-1 text-xs font-semibold text-slate-700">
                            熱度 {zone.heatPercent}%
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <div className="absolute bottom-4 right-4 w-56 rounded-xl border border-slate-200 bg-white/90 p-4 shadow-sm">
                    <p className="text-xs font-semibold text-slate-500">熱度解釋</p>
                    <div className="mt-3 space-y-2">
                      <LegendRow color="#ef4444" label="高熱區" />
                      <LegendRow color="#f59e0b" label="中熱區" />
                      <LegendRow color="#22c55e" label="低熱區" />
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <MiniStat label="最高熱區" value={hottestZone?.name || "待同步"} />
                  <MiniStat label="最長停留" value={longestDwellZone?.name || "待同步"} />
                  <MiniStat label="總停留" value={formatSeconds(totalZoneDwell)} />
                </div>
              </section>

              <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">真實熱力圖輸出</h3>
                    <p className="mt-1 text-sm text-gray-500">實際輸出的疊圖保留在旁邊，讓簡報或展示時不會只有技術圖檔。</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Recorded Output</span>
                </div>

                <div className="overflow-hidden rounded-xl border border-gray-200 bg-slate-900">
                  <Image
                    src={heatmapImageSrc}
                    alt="顧客熱力圖"
                    width={1600}
                    height={900}
                    unoptimized
                    className="h-auto w-full object-cover"
                  />
                </div>

                <div className="mt-4 space-y-4">
                  {zoneStats.map((zone, index) => {
                    const percent = hottestZone ? (zone.Visits / Math.max(hottestZone.Visits, 1)) * 100 : 0;
                    const color = HEAT_COLORS[Math.min(index, HEAT_COLORS.length - 1)];
                    return (
                      <div key={zone.name}>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                            <span className="font-medium text-gray-800">{zone.name}</span>
                          </div>
                          <span className="text-sm text-gray-500">{percent.toFixed(0)}% 熱度</span>
                        </div>
                        <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: color }} />
                        </div>
                      </div>
                    );
                  })}
                  {zoneStats.length === 0 && <EmptyState label="等待熱度統計資料同步..." />}
                </div>
              </section>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
              <h3 className="mb-6 text-lg font-bold text-gray-800">熱度排行</h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {zoneStats.slice(0, 3).map((zone, index) => (
                  <div key={zone.name} className="rounded-2xl border border-gray-100 bg-gray-50 p-5">
                    <p className="text-sm text-gray-500">Rank {index + 1}</p>
                    <p className="mt-2 text-xl font-bold text-gray-900">{zone.name}</p>
                    <p className="mt-3 text-sm text-gray-600">{zone.Visits} 次進入</p>
                    <p className="text-sm text-gray-600">平均停留 {formatSeconds(zone.AvgDwell)}</p>
                  </div>
                ))}
                {zoneStats.length === 0 && <EmptyState label="目前沒有排行資料。" />}
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 font-sans">
      <aside className={`flex flex-col border-r border-gray-200 bg-white transition-all duration-300 ${isSidebarOpen ? "w-64" : "w-20"}`}>
        <div className="flex h-16 items-center justify-between border-b border-gray-100 px-4">
          {isSidebarOpen && <span className="truncate text-xl font-bold text-blue-600">RetailAI Dash</span>}
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
            {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4">
          <NavItem icon={<LayoutDashboard />} label="感知面板" active={activeTab === "overview"} onClick={() => setActiveTab("overview")} open={isSidebarOpen} />
          <NavItem icon={<Map />} label="移動軌跡" active={activeTab === "trajectories"} onClick={() => setActiveTab("trajectories")} open={isSidebarOpen} />
          <NavItem icon={<Clock />} label="停留時間" active={activeTab === "dwell"} onClick={() => setActiveTab("dwell")} open={isSidebarOpen} />
          <NavItem icon={<Flame />} label="檢視熱力圖" active={activeTab === "heatmap"} onClick={() => setActiveTab("heatmap")} open={isSidebarOpen} />
        </nav>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="p-8">
          {fetchError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              Debug Error: {fetchError}
            </div>
          )}
          {renderContent()}
        </div>
      </main>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
  open,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  open: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center space-x-3 rounded-lg px-4 py-3 transition-colors ${
        active ? "bg-blue-50 font-medium text-blue-600" : "text-gray-600 hover:bg-gray-50"
      }`}
    >
      {icon}
      {open && <span>{label}</span>}
    </button>
  );
}

function MetricCard({
  icon,
  iconClassName,
  label,
  value,
  suffix,
  valueClassName,
}: {
  icon: React.ReactNode;
  iconClassName: string;
  label: string;
  value: string;
  suffix?: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center space-x-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className={`rounded-xl p-3 ${iconClassName}`}>{icon}</div>
      <div>
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <p className={`text-3xl font-bold text-gray-900 ${valueClassName || ""}`}>
          {value}
          {suffix && <span className="ml-1 text-base font-normal text-gray-500">{suffix}</span>}
        </p>
      </div>
    </div>
  );
}

function InsightRow({
  title,
  value,
  detail,
  accent,
}: {
  title: string;
  value: string;
  detail: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
        </div>
        <div className={`rounded-full bg-white px-3 py-1 text-xs font-semibold ${accent}`}>{detail}</div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-sm text-slate-700">{label}</span>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
      {label}
    </div>
  );
}
