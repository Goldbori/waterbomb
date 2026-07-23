import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { InventoryRow } from "@/lib/sales-types";

export type SaleRow = {
  id: string;
  created_at: string;
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
};

export function useDashboardData() {
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [inv, sl] = await Promise.all([
      supabase.from("inventory" as never).select("*").order("sku"),
      supabase
        .from("sales" as never)
        .select("*")
        .gte("created_at", startOfToday())
        .eq("cancelled" as never, false)
        .order("created_at", { ascending: true }),
    ]);
    if (inv.data) setInventory(inv.data as unknown as InventoryRow[]);
    if (sl.data) setSales(sl.data as unknown as SaleRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const ch = supabase
      .channel("dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, () => refresh())
      .subscribe();
    const iv = setInterval(refresh, 20000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(iv);
    };
  }, [refresh]);

  return { inventory, sales, loading, refresh };
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
