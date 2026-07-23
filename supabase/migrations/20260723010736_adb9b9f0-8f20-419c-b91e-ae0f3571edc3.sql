
CREATE TABLE public.inventory (
  sku text PRIMARY KEY,
  name text NOT NULL,
  initial_qty int NOT NULL,
  sold int NOT NULL DEFAULT 0
);
GRANT SELECT ON public.inventory TO anon, authenticated;
GRANT ALL ON public.inventory TO service_role;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read inventory" ON public.inventory FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.inventory (sku, name, initial_qty) VALUES
  ('towel_orange', '스포츠타월 오렌지', 40),
  ('towel_mint',   '스포츠타월 민트',   40),
  ('towel_green',  '스포츠타월 그린',   40),
  ('hipsack',      '방수힙색',          50);

CREATE TABLE public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  client_id text UNIQUE NOT NULL,
  bundle text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  price int NOT NULL,
  age_group text NOT NULL,
  gender text NOT NULL,
  group_type text NOT NULL,
  headcount text NOT NULL,
  foreign_flag boolean NOT NULL,
  upsell boolean NOT NULL,
  weather text NOT NULL
);
GRANT SELECT, INSERT ON public.sales TO anon, authenticated;
GRANT ALL ON public.sales TO service_role;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read sales" ON public.sales FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public insert sales" ON public.sales FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE TABLE public.session_settings (
  id int PRIMARY KEY DEFAULT 1,
  weather text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);
GRANT SELECT, INSERT, UPDATE ON public.session_settings TO anon, authenticated;
GRANT ALL ON public.session_settings TO service_role;
ALTER TABLE public.session_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read settings" ON public.session_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public upsert settings" ON public.session_settings FOR INSERT TO anon, authenticated WITH CHECK (id = 1);
CREATE POLICY "public update settings" ON public.session_settings FOR UPDATE TO anon, authenticated USING (id = 1) WITH CHECK (id = 1);
INSERT INTO public.session_settings (id, weather) VALUES (1, NULL);

CREATE OR REPLACE FUNCTION public.insert_sale(
  p_client_id text,
  p_bundle text,
  p_items jsonb,
  p_price int,
  p_age_group text,
  p_gender text,
  p_group_type text,
  p_headcount text,
  p_foreign_flag boolean,
  p_upsell boolean,
  p_weather text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id uuid;
  v_sku text;
  v_counts jsonb := '{}'::jsonb;
  v_key text;
  v_qty int;
  v_avail int;
BEGIN
  -- idempotency: if this client_id already exists, return the existing id
  SELECT id INTO v_sale_id FROM public.sales WHERE client_id = p_client_id;
  IF v_sale_id IS NOT NULL THEN
    RETURN v_sale_id;
  END IF;

  -- Determine SKUs to decrement based on bundle
  IF p_bundle = 'hipsack' THEN
    v_counts := jsonb_build_object('hipsack', 1);
  ELSE
    -- towel bundle: items is array of colors, e.g. ["orange","mint"]
    FOR v_sku IN SELECT jsonb_array_elements_text(p_items) LOOP
      v_key := 'towel_' || v_sku;
      v_counts := jsonb_set(v_counts, ARRAY[v_key],
        to_jsonb(COALESCE((v_counts ->> v_key)::int, 0) + 1));
    END LOOP;
  END IF;

  -- Check availability & lock rows
  FOR v_key, v_qty IN SELECT * FROM jsonb_each_text(v_counts) LOOP
    SELECT (initial_qty - sold) INTO v_avail
      FROM public.inventory WHERE sku = v_key FOR UPDATE;
    IF v_avail IS NULL THEN
      RAISE EXCEPTION 'unknown sku: %', v_key;
    END IF;
    IF v_avail < v_qty::int THEN
      RAISE EXCEPTION '재고 부족: % (남은 %개)', v_key, v_avail;
    END IF;
  END LOOP;

  -- Decrement inventory
  FOR v_key, v_qty IN SELECT * FROM jsonb_each_text(v_counts) LOOP
    UPDATE public.inventory SET sold = sold + v_qty::int WHERE sku = v_key;
  END LOOP;

  INSERT INTO public.sales (
    client_id, bundle, items, price, age_group, gender, group_type,
    headcount, foreign_flag, upsell, weather
  ) VALUES (
    p_client_id, p_bundle, p_items, p_price, p_age_group, p_gender, p_group_type,
    p_headcount, p_foreign_flag, p_upsell, p_weather
  ) RETURNING id INTO v_sale_id;

  RETURN v_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_sale(text, text, jsonb, int, text, text, text, text, boolean, boolean, text) TO anon, authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.sales;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory;
ALTER PUBLICATION supabase_realtime ADD TABLE public.session_settings;
