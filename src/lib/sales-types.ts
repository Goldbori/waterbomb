export type BundleKey = "towel1" | "towel2" | "towel3" | "hipsack";
export type TowelColor = "orange" | "mint" | "green";
export type Weather = "sunny" | "cloudy" | "rain";

export const BUNDLE_PRICES: Record<BundleKey, number> = {
  towel1: 6000,
  towel2: 11000,
  towel3: 15000,
  hipsack: 5000,
};

export const BUNDLE_LABELS: Record<BundleKey, string> = {
  towel1: "스포츠타월 1개",
  towel2: "스포츠타월 2개",
  towel3: "스포츠타월 3개",
  hipsack: "방수힙색",
};

export const TOWEL_COLOR_LABELS: Record<TowelColor, string> = {
  orange: "오렌지",
  mint: "민트",
  green: "그린",
};

export const TOWEL_COLOR_HEX: Record<TowelColor, string> = {
  orange: "#f97316",
  mint: "#5eead4",
  green: "#22c55e",
};

export const WEATHER_LABELS: Record<Weather, string> = {
  sunny: "맑음",
  cloudy: "흐림",
  rain: "비",
};

export const WEATHER_EMOJI: Record<Weather, string> = {
  sunny: "☀️",
  cloudy: "☁️",
  rain: "🌧️",
};

export function bundleTowelCount(b: BundleKey): number {
  if (b === "towel1") return 1;
  if (b === "towel2") return 2;
  if (b === "towel3") return 3;
  return 0;
}

export type SalePayload = {
  client_id: string;
  bundle: BundleKey;
  items: TowelColor[]; // empty for hipsack
  price: number;
  age_group: "10s" | "20s" | "30s" | "40s+";
  gender: "male" | "female" | "mixed";
  group_type: "solo" | "couple" | "friends" | "family";
  headcount: "1" | "2" | "3" | "4+";
  foreign_flag: boolean;
  upsell: boolean;
  weather: Weather;
};

export type InventoryRow = {
  sku: string;
  name: string;
  initial_qty: number;
  sold: number;
};
