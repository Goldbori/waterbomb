import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  BUNDLE_LABELS,
  BUNDLE_PRICES,
  bundleTowelCount,
  TOWEL_COLOR_HEX,
  TOWEL_COLOR_LABELS,
  WEATHER_EMOJI,
  WEATHER_LABELS,
  type BundleKey,
  type SalePayload,
  type TowelColor,
  type Weather,
  type InventoryRow,
} from "@/lib/sales-types";
import { enqueueSale, flushQueue } from "@/lib/offline-queue";
import { useQueueSize } from "@/hooks/use-queue-size";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Package, WifiOff, ClipboardList } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "워터밤 화이팅" },
      { name: "description", content: "Mobile app for real-time event sales data collection and inventory tracking." },
    ],
  }),
  component: SalePage,
});

type Step = "bundle" | "colors" | "customer";

type Customer = {
  age_group?: SalePayload["age_group"];
  gender?: SalePayload["gender"];
  group_type?: SalePayload["group_type"];
  headcount?: SalePayload["headcount"];
  foreign_flag?: boolean;
  upsell?: boolean;
};

function SalePage() {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [inventory, setInventory] = useState<Record<string, InventoryRow>>({});
  const [todayCount, setTodayCount] = useState(0);
  const [todayRevenue, setTodayRevenue] = useState(0);

  const [step, setStep] = useState<Step>("bundle");
  const [bundle, setBundle] = useState<BundleKey | null>(null);
  const [colors, setColors] = useState<TowelColor[]>([]);
  const [customer, setCustomer] = useState<Customer>({});
  const [saving, setSaving] = useState(false);

  const queueSize = useQueueSize();

  // Load weather + realtime inventory + today totals
  useEffect(() => {
    const load = async () => {
      const [{ data: setting }, { data: inv }, { data: sales }] = await Promise.all([
        supabase.from("session_settings" as never).select("*").eq("id", 1).maybeSingle(),
        supabase.from("inventory" as never).select("*"),
        supabase
          .from("sales" as never)
          .select("price")
          .gte("created_at", startOfToday())
          .eq("cancelled" as never, false),
      ]);
      const w = (setting as { weather?: Weather } | null)?.weather;
      if (w) setWeather(w);
      else setWeatherOpen(true);
      if (inv) {
        const map: Record<string, InventoryRow> = {};
        (inv as unknown as InventoryRow[]).forEach((r) => (map[r.sku] = r));
        setInventory(map);
      }
      if (sales) {
        const arr = sales as unknown as { price: number }[];
        setTodayCount(arr.length);
        setTodayRevenue(arr.reduce((s, r) => s + r.price, 0));
      }
    };
    void load();

    const ch = supabase
      .channel("sale-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sales" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const remaining = (sku: string) =>
    inventory[sku] ? inventory[sku].initial_qty - inventory[sku].sold : 0;

  const towelStockOK = (b: BundleKey) => {
    const n = bundleTowelCount(b);
    if (n === 0) return true;
    const total =
      remaining("towel_orange") + remaining("towel_mint") + remaining("towel_green");
    return total >= n;
  };

  const price = bundle ? BUNDLE_PRICES[bundle] : 0;

  const customerReady =
    customer.age_group &&
    customer.gender &&
    customer.group_type &&
    customer.headcount &&
    customer.foreign_flag !== undefined &&
    customer.upsell !== undefined;

  const reset = () => {
    setStep("bundle");
    setBundle(null);
    setColors([]);
    setCustomer({});
  };

  const pickBundle = (b: BundleKey) => {
    if (b === "hipsack") {
      if (remaining("hipsack") <= 0) {
        toast.error("방수힙색 재고가 없습니다");
        return;
      }
      setBundle(b);
      setColors([]);
      setStep("customer");
      return;
    }
    if (!towelStockOK(b)) {
      toast.error("타월 재고가 부족합니다");
      return;
    }
    setBundle(b);
    setColors([]);
    setStep("colors");
  };

  const addColor = (c: TowelColor) => {
    if (!bundle) return;
    const need = bundleTowelCount(bundle);
    // check per-color remaining minus already-in-basket
    const inBasket = colors.filter((x) => x === c).length;
    if (remaining(`towel_${c}`) - inBasket <= 0) return;
    const next = [...colors, c];
    setColors(next);
    if (next.length >= need) {
      setStep("customer");
    }
  };

  const undoColor = () => {
    setColors((prev) => prev.slice(0, -1));
  };

  const save = async () => {
    if (!bundle || !weather || !customerReady) return;
    setSaving(true);
    const payload: SalePayload = {
      client_id: crypto.randomUUID(),
      bundle,
      items: colors,
      price,
      age_group: customer.age_group!,
      gender: customer.gender!,
      group_type: customer.group_type!,
      headcount: customer.headcount!,
      foreign_flag: customer.foreign_flag!,
      upsell: customer.upsell!,
      weather,
    };
    try {
      await enqueueSale(payload);
      // optimistic totals
      setTodayCount((n) => n + 1);
      setTodayRevenue((r) => r + price);
      toast.success(`저장! ${BUNDLE_LABELS[bundle]} · ${price.toLocaleString()}원`);
      reset();
      void flushQueue();
    } catch (e) {
      toast.error("저장 실패: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveWeather = async (w: Weather) => {
    setWeather(w);
    setWeatherOpen(false);
    await supabase
      .from("session_settings" as never)
      .upsert({ id: 1, weather: w, updated_at: new Date().toISOString() } as never);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-4">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setWeatherOpen(true)}
              className="rounded-full bg-slate-800 px-3 py-1 text-sm"
            >
              {weather ? `${WEATHER_EMOJI[weather]} ${WEATHER_LABELS[weather]}` : "날씨 설정"}
            </button>
            {queueSize > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-1 text-xs text-amber-300">
                <WifiOff className="h-3 w-3" /> {queueSize}
              </span>
            )}
          </div>
          <Link
            to="/dashboard"
            className="flex items-center gap-1 rounded-full bg-slate-800 px-3 py-1 text-sm"
          >
            <LayoutDashboard className="h-4 w-4" /> 대시보드
          </Link>
          <Link
            to="/sales"
            className="flex items-center gap-1 rounded-full bg-slate-800 px-3 py-1 text-sm"
          >
            <ClipboardList className="h-4 w-4" /> 판매내역
          </Link>
        </div>
        <div className="mx-auto grid max-w-md grid-cols-2 gap-2 px-3 pb-2">
          <StatCard label="오늘 매출" value={`${todayRevenue.toLocaleString()}원`} />
          <StatCard label="판매 수" value={`${todayCount}건`} />
        </div>
      </header>

      <main className="mx-auto max-w-md px-3 pt-3">
        {step === "bundle" && (
          <BundleGrid pickBundle={pickBundle} inventory={inventory} remaining={remaining} />
        )}

        {step === "colors" && bundle && (
          <ColorPicker
            bundle={bundle}
            colors={colors}
            addColor={addColor}
            undoColor={undoColor}
            remaining={remaining}
            back={reset}
          />
        )}

        {step === "customer" && bundle && (
          <CustomerForm
            bundle={bundle}
            colors={colors}
            price={price}
            customer={customer}
            setCustomer={setCustomer}
            back={() => {
              if (bundle === "hipsack") reset();
              else setStep("colors");
            }}
            save={save}
            saving={saving}
            ready={!!customerReady}
          />
        )}
      </main>

      {weatherOpen && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 p-4">
            <h2 className="mb-3 text-lg font-semibold">현재 날씨는?</h2>
            <div className="grid grid-cols-3 gap-2">
              {(["sunny", "cloudy", "rain"] as Weather[]).map((w) => (
                <button
                  key={w}
                  onClick={() => void saveWeather(w)}
                  className="flex flex-col items-center gap-1 rounded-xl bg-slate-800 py-4 text-lg active:bg-slate-700"
                >
                  <span className="text-3xl">{WEATHER_EMOJI[w]}</span>
                  <span className="text-sm">{WEATHER_LABELS[w]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-900 px-3 py-2">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

function BundleGrid({
  pickBundle,
  inventory,
  remaining,
}: {
  pickBundle: (b: BundleKey) => void;
  inventory: Record<string, InventoryRow>;
  remaining: (sku: string) => number;
}) {
  const towelTotal =
    remaining("towel_orange") + remaining("towel_mint") + remaining("towel_green");
  const items: { key: BundleKey; sub: string; disabled: boolean }[] = [
    { key: "towel1", sub: `타월 재고 ${towelTotal}`, disabled: towelTotal < 1 },
    { key: "towel2", sub: `타월 재고 ${towelTotal}`, disabled: towelTotal < 2 },
    { key: "towel3", sub: `타월 재고 ${towelTotal}`, disabled: towelTotal < 3 },
    {
      key: "hipsack",
      sub: `힙색 재고 ${remaining("hipsack")}`,
      disabled: remaining("hipsack") < 1,
    },
  ];
  return (
    <div>
      <h2 className="mb-2 text-sm font-medium text-slate-400">품목 선택</h2>
      <div className="grid grid-cols-2 gap-3">
        {items.map((it) => (
          <button
            key={it.key}
            disabled={it.disabled}
            onClick={() => pickBundle(it.key)}
            className={cn(
              "flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl border-2 p-3 text-center transition active:scale-95",
              it.disabled
                ? "border-slate-800 bg-slate-900 text-slate-600"
                : "border-cyan-400/40 bg-gradient-to-br from-cyan-500/10 to-blue-500/10 text-white",
            )}
          >
            <Package className="mb-1 h-6 w-6 opacity-70" />
            <div className="text-base font-bold leading-tight">{BUNDLE_LABELS[it.key]}</div>
            <div className="text-lg font-black text-cyan-300">
              {BUNDLE_PRICES[it.key].toLocaleString()}원
            </div>
            <div className="text-[10px] text-slate-400">{it.sub}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ColorPicker({
  bundle,
  colors,
  addColor,
  undoColor,
  remaining,
  back,
}: {
  bundle: BundleKey;
  colors: TowelColor[];
  addColor: (c: TowelColor) => void;
  undoColor: () => void;
  remaining: (sku: string) => number;
  back: () => void;
}) {
  const need = bundleTowelCount(bundle);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button onClick={back} className="text-sm text-slate-400">
          ← 취소
        </button>
        <h2 className="text-sm font-medium text-slate-400">
          색상 선택 ({colors.length}/{need})
        </h2>
        <button
          onClick={undoColor}
          disabled={!colors.length}
          className="text-sm text-slate-400 disabled:opacity-30"
        >
          되돌리기
        </button>
      </div>
      <div className="mb-3 flex min-h-14 items-center justify-center gap-2 rounded-xl bg-slate-900 p-3">
        {colors.length === 0 && <span className="text-sm text-slate-500">색상을 탭하세요</span>}
        {colors.map((c, i) => (
          <div
            key={i}
            className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-slate-900"
            style={{ backgroundColor: TOWEL_COLOR_HEX[c] }}
          >
            {TOWEL_COLOR_LABELS[c][0]}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {(["orange", "mint", "green"] as TowelColor[]).map((c) => {
          const inBasket = colors.filter((x) => x === c).length;
          const rem = remaining(`towel_${c}`) - inBasket;
          const disabled = rem <= 0;
          return (
            <button
              key={c}
              disabled={disabled}
              onClick={() => addColor(c)}
              className={cn(
                "flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border-2 p-2 transition active:scale-95",
                disabled ? "border-slate-800 bg-slate-900 opacity-40" : "border-white/10",
              )}
              style={{ backgroundColor: disabled ? undefined : TOWEL_COLOR_HEX[c] }}
            >
              <div className="text-lg font-black text-slate-900">{TOWEL_COLOR_LABELS[c]}</div>
              <div className="rounded-full bg-black/20 px-2 py-0.5 text-xs font-medium text-white">
                남은 {remaining(`towel_${c}`)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CustomerForm({
  bundle,
  colors,
  price,
  customer,
  setCustomer,
  back,
  save,
  saving,
  ready,
}: {
  bundle: BundleKey;
  colors: TowelColor[];
  price: number;
  customer: Customer;
  setCustomer: (c: Customer) => void;
  back: () => void;
  save: () => void;
  saving: boolean;
  ready: boolean;
}) {
  const set = <K extends keyof Customer>(k: K, v: Customer[K]) =>
    setCustomer({ ...customer, [k]: v });

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button onClick={back} className="text-sm text-slate-400">
          ← 뒤로
        </button>
        <div className="text-sm text-slate-400">고객 정보</div>
        <div className="text-sm font-bold text-cyan-300">{price.toLocaleString()}원</div>
      </div>

      <div className="mb-3 rounded-xl bg-slate-900 px-3 py-2 text-sm">
        <span className="text-slate-400">{BUNDLE_LABELS[bundle]}</span>
        {colors.length > 0 && (
          <span className="ml-2 inline-flex gap-1">
            {colors.map((c, i) => (
              <span
                key={i}
                className="inline-block h-3 w-3 rounded-full align-middle"
                style={{ backgroundColor: TOWEL_COLOR_HEX[c] }}
              />
            ))}
          </span>
        )}
      </div>

      <ChipGroup
        label="연령대"
        options={[
          ["10s", "10대"],
          ["20s", "20대"],
          ["30s", "30대"],
          ["40s+", "40대+"],
        ]}
        value={customer.age_group}
        onChange={(v) => set("age_group", v as Customer["age_group"])}
      />
      <ChipGroup
        label="성별"
        options={[
          ["male", "남"],
          ["female", "여"],
          ["mixed", "혼합"],
        ]}
        value={customer.gender}
        onChange={(v) => set("gender", v as Customer["gender"])}
      />
      <ChipGroup
        label="구성"
        options={[
          ["solo", "혼자"],
          ["couple", "커플"],
          ["friends", "친구"],
          ["family", "가족"],
        ]}
        value={customer.group_type}
        onChange={(v) => set("group_type", v as Customer["group_type"])}
      />
      <ChipGroup
        label="인원"
        options={[
          ["1", "1"],
          ["2", "2"],
          ["3", "3"],
          ["4+", "4+"],
        ]}
        value={customer.headcount}
        onChange={(v) => set("headcount", v as Customer["headcount"])}
      />
      <ChipGroup
        label="외국인"
        options={[
          ["false", "내국인"],
          ["true", "외국인 포함"],
        ]}
        value={customer.foreign_flag === undefined ? undefined : String(customer.foreign_flag)}
        onChange={(v) => set("foreign_flag", v === "true")}
      />
      <ChipGroup
        label="업셀"
        options={[
          ["false", "아니오"],
          ["true", "예"],
        ]}
        value={customer.upsell === undefined ? undefined : String(customer.upsell)}
        onChange={(v) => set("upsell", v === "true")}
      />

      <button
        onClick={save}
        disabled={!ready || saving}
        className={cn(
          "sticky bottom-3 mt-4 w-full rounded-2xl py-4 text-lg font-black transition active:scale-95",
          ready
            ? "bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/30"
            : "bg-slate-800 text-slate-500",
        )}
      >
        {saving ? "저장 중..." : ready ? "저장" : "모든 항목 선택"}
      </button>
    </div>
  );
}

function ChipGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [string, string][];
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs text-slate-400">{label}</div>
      <div className="grid grid-flow-col auto-cols-fr gap-2">
        {options.map(([v, l]) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={cn(
              "rounded-xl py-3 text-sm font-semibold transition active:scale-95",
              value === v
                ? "bg-cyan-400 text-slate-950"
                : "bg-slate-900 text-slate-300 border border-slate-800",
            )}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
