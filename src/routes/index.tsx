import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { LayoutDashboard, Package, WifiOff, ClipboardList, ShoppingCart, X, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "워터밤 화이팅" },
      { name: "description", content: "Mobile sales input app" },
    ],
  }),
  component: SalePage,
});

// 카트 아이템: 타월은 색상 미정(나중에 채움), 힙색은 색상 없음
type CartItem = {
  id: string; // uuid for key
  bundle: BundleKey;
  colors: TowelColor[]; // 채워지면 색상 확정
};

type Step = "cart" | "colors" | "customer";

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

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  // colors step: which cart item index we're filling
  const [colorIdx, setColorIdx] = useState(0);
  const [step, setStep] = useState<Step>("cart");
  const [customer, setCustomer] = useState<Customer>({});
  const [saving, setSaving] = useState(false);

  const queueSize = useQueueSize();

  useEffect(() => {
    const load = async () => {
      const [{ data: setting }, { data: inv }, { data: sales }] = await Promise.all([
        supabase.from("session_settings" as never).select("*").eq("id", 1).maybeSingle(),
        supabase.from("inventory" as never).select("*"),
        supabase.from("sales" as never).select("price")
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
    const ch = supabase.channel("sale-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sales" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const remaining = (sku: string) =>
    inventory[sku] ? inventory[sku].initial_qty - inventory[sku].sold : 0;

  // 카트에 담긴 타월 수량을 재고에서 차감한 가용 재고
  const cartTowelUsed = (color: TowelColor) =>
    cart.filter(item => item.bundle !== "hipsack")
      .flatMap(item => item.colors)
      .filter(c => c === color).length;

  const availColor = (color: TowelColor) =>
    remaining(`towel_${color}`) - cartTowelUsed(color);

  const towelAvailTotal = () =>
    availColor("orange") + availColor("mint") + availColor("green");

  const canAddBundle = (b: BundleKey) => {
    if (b === "hipsack") {
      const inCart = cart.filter(i => i.bundle === "hipsack").length;
      return remaining("hipsack") - inCart > 0;
    }
    return towelAvailTotal() >= bundleTowelCount(b);
  };

  const cartTotal = cart.reduce((s: number, i: CartItem) => s + BUNDLE_PRICES[i.bundle], 0);

  const addToCart = (b: BundleKey) => {
    if (!canAddBundle(b)) {
      toast.error("재고가 부족합니다");
      return;
    }
    setCart((prev: CartItem[]) => [...prev, { id: crypto.randomUUID(), bundle: b, colors: [] }]);
  };

  const removeFromCart = (id: string) => {
    setCart((prev: CartItem[]) => prev.filter((i: CartItem) => i.id !== id));
  };

  const resetAll = () => {
    setCart([]);
    setColorIdx(0);
    setStep("cart");
    setCustomer({});
  };

  // 주문 확정: 타월 항목이 있으면 색상 단계, 없으면 고객 정보로
  const confirmCart = () => {
    if (cart.length === 0) return;
    const firstTowelIdx = cart.findIndex(i => bundleTowelCount(i.bundle) > 0);
    if (firstTowelIdx >= 0) {
      setColorIdx(firstTowelIdx);
      setStep("colors");
    } else {
      setStep("customer");
    }
  };

  // 색상 선택 완료 → 다음 타월 항목 or 고객 정보
  const onColorsDone = (colors: TowelColor[]) => {
    const updated = cart.map((item: CartItem, idx: number) =>
      idx === colorIdx ? { ...item, colors } : item
    );
    setCart(updated);
    // find next towel item without colors
    const nextIdx = updated.findIndex((i: CartItem, idx: number) =>
      idx > colorIdx && bundleTowelCount(i.bundle) > 0 && i.colors.length === 0
    );
    if (nextIdx >= 0) {
      setColorIdx(nextIdx);
    } else {
      setStep("customer");
    }
  };

  const customerReady =
    customer.age_group && customer.gender && customer.group_type &&
    customer.headcount && customer.foreign_flag !== undefined && customer.upsell !== undefined;

  const save = async () => {
    if (!weather || !customerReady || cart.length === 0) return;
    setSaving(true);
    try {
      for (const item of cart) {
        const payload: SalePayload = {
          client_id: crypto.randomUUID(),
          bundle: item.bundle,
          items: item.colors,
          price: BUNDLE_PRICES[item.bundle],
          age_group: customer.age_group!,
          gender: customer.gender!,
          group_type: customer.group_type!,
          headcount: customer.headcount!,
          foreign_flag: customer.foreign_flag!,
          upsell: customer.upsell!,
          weather,
        };
        await enqueueSale(payload);
      }
      setTodayCount((n: number) => n + cart.length);
      setTodayRevenue((r: number) => r + cartTotal);
      toast.success(`저장! ${cart.length}건 · ${cartTotal.toLocaleString()}원`);
      resetAll();
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
    await supabase.from("session_settings" as never)
      .upsert({ id: 1, weather: w, updated_at: new Date().toISOString() } as never);
  };

  const currentTowelItem = step === "colors" ? cart[colorIdx] : null;
  const towelItemsDone = cart.filter(i => bundleTowelCount(i.bundle) > 0).length;
  const currentTowelNum = cart.slice(0, colorIdx + 1).filter(i => bundleTowelCount(i.bundle) > 0).length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-24">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <button onClick={() => setWeatherOpen(true)}
              className="rounded-full bg-slate-800 px-3 py-1 text-sm">
              {weather ? `${WEATHER_EMOJI[weather]} ${WEATHER_LABELS[weather]}` : "날씨 설정"}
            </button>
            {queueSize > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-1 text-xs text-amber-300">
                <WifiOff className="h-3 w-3" /> {queueSize}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link to="/dashboard" className="flex items-center gap-1 rounded-full bg-slate-800 px-3 py-1 text-sm">
              <LayoutDashboard className="h-4 w-4" />
            </Link>
            <Link to="/sales" className="flex items-center gap-1 rounded-full bg-slate-800 px-3 py-1 text-sm">
              <ClipboardList className="h-4 w-4" />
            </Link>
          </div>
        </div>
        <div className="mx-auto grid max-w-md grid-cols-2 gap-2 px-3 pb-2">
          <StatCard label="오늘 매출" value={`${todayRevenue.toLocaleString()}원`} />
          <StatCard label="판매 수" value={`${todayCount}건`} />
        </div>
      </header>

      <main className="mx-auto max-w-md px-3 pt-4">
        {step === "cart" && (
          <CartStep
            cart={cart}
            inventory={inventory}
            remaining={remaining}
            canAddBundle={canAddBundle}
            addToCart={addToCart}
            removeFromCart={removeFromCart}
            cartTotal={cartTotal}
            confirmCart={confirmCart}
          />
        )}
        {step === "colors" && currentTowelItem && (
          <ColorPicker
            bundle={currentTowelItem.bundle}
            itemLabel={`타월 항목 ${currentTowelNum}/${towelItemsDone}`}
            remaining={remaining}
            cartTowelUsed={cartTowelUsed}
            onDone={onColorsDone}
            onBack={resetAll}
          />
        )}
        {step === "customer" && (
          <CustomerForm
            cart={cart}
            cartTotal={cartTotal}
            customer={customer}
            setCustomer={setCustomer}
            back={() => {
              const hasTowels = cart.some(i => bundleTowelCount(i.bundle) > 0);
              if (hasTowels) {
                // go back to last towel color step
                const lastTowelIdx = [...cart].reverse().findIndex(i => bundleTowelCount(i.bundle) > 0);
                setColorIdx(cart.length - 1 - lastTowelIdx);
                setStep("colors");
              } else {
                setStep("cart");
              }
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
                <button key={w} onClick={() => void saveWeather(w)}
                  className="flex flex-col items-center gap-1 rounded-xl bg-slate-800 py-4 text-lg active:bg-slate-700">
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

// ── Step 1: 장바구니 ──────────────────────────────────────────────────────────
function CartStep({
  cart, inventory, remaining, canAddBundle, addToCart, removeFromCart, cartTotal, confirmCart,
}: {
  cart: CartItem[];
  inventory: Record<string, InventoryRow>;
  remaining: (sku: string) => number;
  canAddBundle: (b: BundleKey) => boolean;
  addToCart: (b: BundleKey) => void;
  removeFromCart: (id: string) => void;
  cartTotal: number;
  confirmCart: () => void;
}) {
  const towelTotal = remaining("towel_orange") + remaining("towel_mint") + remaining("towel_green");
  const bundles: { key: BundleKey; stock: string }[] = [
    { key: "towel1", stock: `재고 ${towelTotal}` },
    { key: "towel2", stock: `재고 ${towelTotal}` },
    { key: "towel3", stock: `재고 ${towelTotal}` },
    { key: "hipsack", stock: `재고 ${remaining("hipsack")}` },
  ];

  return (
    <div>
      {/* 품목 버튼 */}
      <h2 className="mb-2 text-sm font-medium text-slate-400">품목 선택 (여러 번 탭 가능)</h2>
      <div className="grid grid-cols-2 gap-3 mb-5">
        {bundles.map(({ key, stock }) => {
          const disabled = !canAddBundle(key);
          const inCart = cart.filter(i => i.bundle === key).length;
          return (
            <button key={key} disabled={disabled} onClick={() => addToCart(key)}
              className={cn(
                "relative flex flex-col items-center justify-center gap-1 rounded-2xl border-2 p-4 text-center transition active:scale-95",
                disabled
                  ? "border-slate-800 bg-slate-900 text-slate-600"
                  : "border-cyan-400/40 bg-gradient-to-br from-cyan-500/10 to-blue-500/10 text-white",
              )}>
              {inCart > 0 && (
                <span className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-cyan-400 text-xs font-black text-slate-950">
                  {inCart}
                </span>
              )}
              <Package className="h-6 w-6 opacity-70" />
              <div className="text-sm font-bold leading-tight">{BUNDLE_LABELS[key]}</div>
              <div className="text-lg font-black text-cyan-300">{BUNDLE_PRICES[key].toLocaleString()}원</div>
              <div className="text-[10px] text-slate-400">{stock}</div>
            </button>
          );
        })}
      </div>

      {/* 담긴 목록 */}
      {cart.length > 0 && (
        <div className="mb-4 rounded-2xl bg-slate-900 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
              <ShoppingCart className="h-4 w-4 text-cyan-400" />
              장바구니 ({cart.length}건)
            </div>
            <div className="text-sm font-black text-cyan-300">{cartTotal.toLocaleString()}원</div>
          </div>
          {cart.map((item, idx) => (
            <div key={item.id} className="flex items-center justify-between px-4 py-3 border-b border-slate-800/60 last:border-0">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 w-5">{idx + 1}.</span>
                <span className="text-sm font-semibold">{BUNDLE_LABELS[item.bundle]}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-cyan-300">{BUNDLE_PRICES[item.bundle].toLocaleString()}원</span>
                <button onClick={() => removeFromCart(item.id)}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-slate-400 active:bg-red-500/30 active:text-red-400">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 주문 확정 버튼 */}
      <button onClick={confirmCart} disabled={cart.length === 0}
        className={cn(
          "fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-1.5rem)] max-w-md flex items-center justify-between rounded-2xl px-5 py-4 text-base font-black transition active:scale-95",
          cart.length > 0
            ? "bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/30"
            : "bg-slate-800 text-slate-500",
        )}>
        <span>주문 확정</span>
        {cart.length > 0 && (
          <span className="flex items-center gap-1">
            {cart.length}건 · {cartTotal.toLocaleString()}원
            <ChevronRight className="h-5 w-5" />
          </span>
        )}
      </button>
    </div>
  );
}

// ── Step 2: 색상 선택 ─────────────────────────────────────────────────────────
function ColorPicker({
  bundle, itemLabel, remaining, cartTowelUsed, onDone, onBack,
}: {
  bundle: BundleKey;
  itemLabel: string;
  remaining: (sku: string) => number;
  cartTowelUsed: (color: TowelColor) => number;
  onDone: (colors: TowelColor[]) => void;
  onBack: () => void;
}) {
  const need = bundleTowelCount(bundle);
  const [colors, setColors] = useState<TowelColor[]>([]);

  const avail = (c: TowelColor) => remaining(`towel_${c}`) - cartTowelUsed(c) - colors.filter((x: TowelColor) => x === c).length;

  const addColor = (c: TowelColor) => {
    if (avail(c) <= 0) return;
    const next = [...colors, c];
    setColors(next);
    if (next.length >= need) onDone(next);
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-slate-400">← 취소</button>
        <h2 className="text-sm font-semibold text-slate-300">
          색상 선택 <span className="text-slate-500">({itemLabel})</span>
        </h2>
        <button onClick={() => setColors((prev: TowelColor[]) => prev.slice(0, -1))} disabled={!colors.length}
          className="text-sm text-slate-400 disabled:opacity-30">되돌리기</button>
      </div>

      {/* 선택된 색상 미리보기 */}
      <div className="mb-4 flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3">
        {colors.length === 0
          ? <span className="text-sm text-slate-500">{need}개 색상을 탭하세요</span>
          : colors.map((c, i) => (
            <div key={i}
              className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-black text-slate-900 shadow-lg"
              style={{ backgroundColor: TOWEL_COLOR_HEX[c] }}>
              {TOWEL_COLOR_LABELS[c][0]}
            </div>
          ))
        }
        {/* 남은 슬롯 표시 */}
        {Array.from({ length: need - colors.length }).map((_, i) => (
          <div key={`empty-${i}`}
            className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-slate-700 text-slate-600 text-xs">
            {colors.length + i + 1}
          </div>
        ))}
      </div>

      {/* 진행 표시 */}
      <div className="mb-4 text-center text-xs text-slate-500">
        {colors.length} / {need} 선택됨
      </div>

      {/* 색상 버튼 */}
      <div className="grid grid-cols-3 gap-3">
        {(["orange", "mint", "green"] as TowelColor[]).map((c) => {
          const a = avail(c);
          const disabled = a <= 0;
          return (
            <button key={c} disabled={disabled} onClick={() => addColor(c)}
              className={cn(
                "flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border-2 p-3 transition active:scale-95",
                disabled ? "border-slate-800 bg-slate-900 opacity-40" : "border-white/20 shadow-md",
              )}
              style={{ backgroundColor: disabled ? undefined : TOWEL_COLOR_HEX[c] }}>
              <div className="text-lg font-black text-slate-900">{TOWEL_COLOR_LABELS[c]}</div>
              <div className="rounded-full bg-black/20 px-2 py-0.5 text-xs font-semibold text-white">
                남은 {remaining(`towel_${c}`)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Step 3: 고객 정보 ─────────────────────────────────────────────────────────
function CustomerForm({
  cart, cartTotal, customer, setCustomer, back, save, saving, ready,
}: {
  cart: CartItem[];
  cartTotal: number;
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
      <div className="mb-3 flex items-center justify-between">
        <button onClick={back} className="text-sm text-slate-400">← 뒤로</button>
        <div className="text-sm text-slate-400">고객 정보</div>
        <div className="text-sm font-black text-cyan-300">{cartTotal.toLocaleString()}원</div>
      </div>

      {/* 주문 요약 */}
      <div className="mb-4 rounded-xl bg-slate-900 px-3 py-2">
        {cart.map((item, idx) => (
          <div key={item.id} className="flex items-center gap-2 py-1 text-sm">
            <span className="text-slate-500 text-xs w-4">{idx + 1}.</span>
            <span className="text-slate-300 font-semibold">{BUNDLE_LABELS[item.bundle]}</span>
            {item.colors.length > 0 && (
              <span className="inline-flex gap-1 ml-1">
                {item.colors.map((c, i) => (
                  <span key={i} className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: TOWEL_COLOR_HEX[c] }} />
                ))}
              </span>
            )}
            <span className="ml-auto text-cyan-300 font-bold">{BUNDLE_PRICES[item.bundle].toLocaleString()}원</span>
          </div>
        ))}
      </div>

      <ChipGroup label="연령대"
        options={[["10s","10대"],["20s","20대"],["30s","30대"],["40s+","40대+"]]}
        value={customer.age_group}
        onChange={(v) => set("age_group", v as Customer["age_group"])} />
      <ChipGroup label="성별"
        options={[["male","남"],["female","여"],["mixed","혼합"]]}
        value={customer.gender}
        onChange={(v) => set("gender", v as Customer["gender"])} />
      <ChipGroup label="구성"
        options={[["solo","혼자"],["couple","커플"],["friends","친구"],["family","가족"]]}
        value={customer.group_type}
        onChange={(v) => set("group_type", v as Customer["group_type"])} />
      <ChipGroup label="인원"
        options={[["1","1"],["2","2"],["3","3"],["4+","4+"]]}
        value={customer.headcount}
        onChange={(v) => set("headcount", v as Customer["headcount"])} />
      <ChipGroup label="외국인"
        options={[["false","내국인"],["true","외국인 포함"]]}
        value={customer.foreign_flag === undefined ? undefined : String(customer.foreign_flag)}
        onChange={(v) => set("foreign_flag", v === "true")} />
      <ChipGroup label="업셀"
        options={[["false","아니오"],["true","예"]]}
        value={customer.upsell === undefined ? undefined : String(customer.upsell)}
        onChange={(v) => set("upsell", v === "true")} />

      <button onClick={save} disabled={!ready || saving}
        className={cn(
          "sticky bottom-3 mt-4 w-full rounded-2xl py-4 text-lg font-black transition active:scale-95",
          ready ? "bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/30" : "bg-slate-800 text-slate-500",
        )}>
        {saving ? "저장 중..." : ready ? `저장 (${cart.length}건)` : "모든 항목 선택"}
      </button>
    </div>
  );
}

function ChipGroup({ label, options, value, onChange }: {
  label: string; options: [string, string][]; value: string | undefined; onChange: (v: string) => void;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs text-slate-400">{label}</div>
      <div className="grid grid-flow-col auto-cols-fr gap-2">
        {options.map(([v, l]) => (
          <button key={v} onClick={() => onChange(v)}
            className={cn(
              "rounded-xl py-3 text-sm font-semibold transition active:scale-95",
              value === v ? "bg-cyan-400 text-slate-950" : "bg-slate-900 text-slate-300 border border-slate-800",
            )}>
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
