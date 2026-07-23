-- Add cancelled and updated_at columns to sales
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS cancelled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- RPC: cancel_sale
-- Marks a sale as cancelled and restores inventory
CREATE OR REPLACE FUNCTION public.cancel_sale(
  p_sale_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_sku text;
  v_counts jsonb := '{}'::jsonb;
  v_key text;
  v_qty int;
BEGIN
  -- Fetch and lock the sale row
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale not found: %', p_sale_id;
  END IF;

  IF v_sale.cancelled THEN
    -- Already cancelled — idempotent, just return
    RETURN;
  END IF;

  -- Determine which SKUs to restore
  IF v_sale.bundle = 'hipsack' THEN
    v_counts := jsonb_build_object('hipsack', 1);
  ELSE
    FOR v_sku IN SELECT jsonb_array_elements_text(v_sale.items) LOOP
      v_key := 'towel_' || v_sku;
      v_counts := jsonb_set(v_counts, ARRAY[v_key],
        to_jsonb(COALESCE((v_counts ->> v_key)::int, 0) + 1));
    END LOOP;
  END IF;

  -- Restore inventory
  FOR v_key, v_qty IN SELECT * FROM jsonb_each_text(v_counts) LOOP
    UPDATE public.inventory SET sold = GREATEST(sold - v_qty::int, 0) WHERE sku = v_key;
  END LOOP;

  -- Mark as cancelled
  UPDATE public.sales
    SET cancelled = true, updated_at = now()
    WHERE id = p_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_sale(uuid) TO anon, authenticated;
