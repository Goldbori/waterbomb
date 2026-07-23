import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { BUNDLE_LABELS, TOWEL_COLOR_HEX, TOWEL_COLOR_LABELS } from "@/lib/sales-types";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "대시보드 · 워터밤" },
      { name: "description", content: "실시간 매출·재고·시간대 대시보드" },
    ],
  }),
  component: DashboardPage,
});

const SKU_LABELS: Record<string, string> = {
  towel_orange: "타월 오렌지",
  towel_mint: "타월 민트",
  towel_green: "타월 그린",
  hipsack: "방수힙색",
};

function DashboardPage() {
  const { inventory, sales, loading } = useDashboardData();

  const totals = useMemo(() => {
    const revenue = sales.reduce((s, r) => s + r.price, 0);
    return { revenue, count: sales.length };
  }, [sales]);

  const bundleCounts = useMemo(() => {
    const c: Record<string, number> = {};
    sales.forEach((s) => (c[s.bundle] = (c[s.bundle] ?? 0) + 1));
    return c;
  }, [sales]);

  const hourly = useMemo(() => {
    const arr = Array.from({ length: 14 }, (_, i) => ({
      hour: `${9 + i}시`,
      h: 9 + i,
      count: 0,
      revenue: 0,
    }));
    sales.forEach((s) => {
      const h = new Date(s.created_at).getHours();
      const bucket = arr.find((a) => a.h === h);
      if (bucket) {
        bucket.count += 1;
        bucket.revenue += s.price;
      }
    });
    return arr;
  }, [sales]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-8">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between px-3 py-3">
          <Link to="/" className="flex items-center gap-1 text-sm text-slate-300">
            <ArrowLeft className="h-4 w-4" /> 입력
          </Link>
          <div className="font-bold">대시보드</div>
          <div className="w-14" />
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-4 px-3 pt-4">
        <section className="grid grid-cols-2 gap-3">
          <BigStat label="오늘 매출" value={`${totals.revenue.toLocaleString()}원`} accent />
          <BigStat label="총 판매 수" value={`${totals.count}건`} />
        </section>

        <section>
          <h2 className="mb-2 text-sm font-medium text-slate-400">품목별 · 재고</h2>
          <div className="space-y-2">
            {inventory.map((row) => {
              const remaining = row.initial_qty - row.sold;
              const low = remaining <= 10;
              const bundleSold =
                row.sku === "hipsack" ? bundleCounts["hipsack"] ?? 0 : row.sold;
              return (
                <div
                  key={row.sku}
                  className="flex items-center justify-between rounded-xl bg-slate-900 px-3 py-3"
                >
                  <div className="flex items-center gap-3">
                    {row.sku.startsWith("towel_") && (
                      <div
                        className="h-4 w-4 rounded-full"
                        style={{
                          backgroundColor:
                            TOWEL_COLOR_HEX[row.sku.replace("towel_", "") as never],
                        }}
                      />
                    )}
                    <div>
                      <div className="font-semibold">{SKU_LABELS[row.sku] ?? row.name}</div>
                      <div className="text-xs text-slate-400">판매 {row.sold}개</div>
                    </div>
                  </div>
                  <div
                    className={
                      "flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold " +
                      (low
                        ? "bg-red-500/20 text-red-300"
                        : "bg-slate-800 text-slate-200")
                    }
                  >
                    {low && <AlertTriangle className="h-3.5 w-3.5" />}
                    남은 {remaining}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-medium text-slate-400">번들별 판매</h2>
          <div className="grid grid-cols-2 gap-2">
            {(["towel1", "towel2", "towel3", "hipsack"] as const).map((k) => (
              <div key={k} className="rounded-xl bg-slate-900 px-3 py-2">
                <div className="text-xs text-slate-400">{BUNDLE_LABELS[k]}</div>
                <div className="text-lg font-bold">{bundleCounts[k] ?? 0}건</div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-medium text-slate-400">시간대별 판매</h2>
          <div className="rounded-xl bg-slate-900 p-2">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourly}>
                  <CartesianGrid stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="hour" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: "#0f172a",
                      border: "1px solid #334155",
                      borderRadius: 8,
                    }}
                    labelStyle={{ color: "#e2e8f0" }}
                  />
                  <Bar dataKey="count" fill="#22d3ee" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        {loading && <div className="text-center text-sm text-slate-500">불러오는 중...</div>}
      </main>
    </div>
  );
}

function BigStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        "rounded-2xl px-4 py-3 " +
        (accent
          ? "bg-gradient-to-br from-cyan-500 to-blue-600 text-white"
          : "bg-slate-900 text-slate-100")
      }
    >
      <div className={"text-xs " + (accent ? "text-white/80" : "text-slate-400")}>{label}</div>
      <div className="mt-1 text-2xl font-black">{value}</div>
    </div>
  );
}
