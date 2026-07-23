import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  BUNDLE_LABELS,
  TOWEL_COLOR_HEX,
  TOWEL_COLOR_LABELS,
  BUNDLE_PRICES,
  type TowelColor,
  type BundleKey,
} from "@/lib/sales-types";
import { ArrowLeft, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/sales")({
  head: () => ({
    meta: [{ title: "판매내역 · 워터밤" }],
  }),
  component: SalesPage,
});

type SaleRow = {
  id: string;
  created_at: string;
  updated_at: string;
  bundle: string;
  items: string[];
  price: number;
  age_group: string;
  gender: string;
  group_type: string;
  headcount: string;
  foreign_flag: boolean;
  upsell: boolean;
  weather: string;
  cancelled: boolean;
};

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

const AGE_LABELS: Record<string, string> = {
  "10s": "10대",
  "20s": "20대",
  "30s": "30대",
  "40s+": "40대+",
};
const GENDER_LABELS: Record<string, string> = {
  male: "남",
  female: "여",
  mixed: "혼합",
};
const GROUP_LABELS: Record<string, string> = {
  solo: "혼자",
  couple: "커플",
  friends: "친구",
  family: "가족",
};

function SalesPage() {
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("sales" as never)
      .select("*")
      .gte("created_at", startOfToday())
      .order("created_at", { ascending: false });
    if (data) setSales(data as unknown as SaleRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("sales-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const confirmCancel = (id: string) => setConfirmId(id);

  const doCancel = async () => {
    if (!confirmId) return;
    setCancelling(true);
    try {
      const { error } = await supabase.rpc("cancel_sale" as never, {
        p_sale_id: confirmId,
      } as never);
      if (error) throw new Error(error.message);
      toast.success("판매 취소 완료");
      setConfirmId(null);
      void load();
    } catch (e) {
      toast.error("취소 실패: " + (e as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  const activeSales = sales.filter((s) => !s.cancelled);
  const cancelledSales = sales.filter((s) => s.cancelled);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-8">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between px-3 py-3">
          <Link to="/" className="flex items-center gap-1 text-sm text-slate-300">
            <ArrowLeft className="h-4 w-4" /> 입력
          </Link>
          <div className="font-bold">판매내역</div>
          <div className="w-14" />
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-4 px-3 pt-4">
        {loading && (
          <div className="text-center text-sm text-slate-500">불러오는 중...</div>
        )}

        {!loading && sales.length === 0 && (
          <div className="rounded-xl bg-slate-900 px-4 py-8 text-center text-slate-500">
            오늘 판매 내역이 없습니다
          </div>
        )}

        {activeSales.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-medium text-slate-400">
              오늘 판매 ({activeSales.length}건)
            </h2>
            <div className="space-y-2">
              {activeSales.map((s) => (
                <SaleCard
                  key={s.id}
                  sale={s}
                  onCancel={() => confirmCancel(s.id)}
                />
              ))}
            </div>
          </section>
        )}

        {cancelledSales.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-medium text-slate-400">
              취소됨 ({cancelledSales.length}건)
            </h2>
            <div className="space-y-2">
              {cancelledSales.map((s) => (
                <SaleCard key={s.id} sale={s} cancelled />
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Confirm dialog */}
      {confirmId && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 p-5 shadow-xl">
            <h3 className="mb-2 text-lg font-bold">판매 취소</h3>
            <p className="mb-5 text-sm text-slate-400">
              정말 이 판매를 취소하시겠습니까?<br />
              취소 시 재고가 자동으로 복원됩니다.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmId(null)}
                disabled={cancelling}
                className="flex-1 rounded-xl bg-slate-800 py-3 text-sm font-semibold text-slate-300 active:bg-slate-700"
              >
                아니오
              </button>
              <button
                onClick={() => void doCancel()}
                disabled={cancelling}
                className="flex-1 rounded-xl bg-red-500 py-3 text-sm font-bold text-white active:bg-red-600 disabled:opacity-50"
              >
                {cancelling ? "취소 중..." : "예, 취소합니다"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SaleCard({
  sale,
  cancelled,
  onCancel,
}: {
  sale: SaleRow;
  cancelled?: boolean;
  onCancel?: () => void;
}) {
  const colors = sale.items as TowelColor[];
  const bundle = sale.bundle as BundleKey;

  return (
    <div
      className={cn(
        "flex items-start justify-between rounded-xl px-3 py-3",
        cancelled ? "bg-slate-900/50 opacity-50" : "bg-slate-900",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn("text-sm font-bold", cancelled && "line-through text-slate-500")}>
            {BUNDLE_LABELS[bundle] ?? sale.bundle}
          </span>
          {colors.length > 0 && (
            <span className="inline-flex gap-1">
              {colors.map((c, i) => (
                <span
                  key={i}
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: TOWEL_COLOR_HEX[c] }}
                  title={TOWEL_COLOR_LABELS[c]}
                />
              ))}
            </span>
          )}
          {cancelled && (
            <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold text-red-400">
              취소
            </span>
          )}
        </div>
        <div className="mt-0.5 text-lg font-black text-cyan-300">
          {sale.price.toLocaleString()}원
        </div>
        <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-slate-500">
          <span>{formatTime(sale.created_at)}</span>
          <span>·</span>
          <span>{AGE_LABELS[sale.age_group] ?? sale.age_group}</span>
          <span>{GENDER_LABELS[sale.gender] ?? sale.gender}</span>
          <span>{GROUP_LABELS[sale.group_type] ?? sale.group_type}</span>
          <span>{sale.headcount}명</span>
          {sale.foreign_flag && <span>· 외국인</span>}
          {sale.upsell && <span>· 업셀</span>}
        </div>
      </div>
      {!cancelled && onCancel && (
        <button
          onClick={onCancel}
          className="ml-3 flex shrink-0 items-center gap-1 rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-400 active:bg-red-500/20"
        >
          <XCircle className="h-4 w-4" />
          취소
        </button>
      )}
    </div>
  );
}
