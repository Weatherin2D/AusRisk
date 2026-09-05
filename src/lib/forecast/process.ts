import type {
  CategoryStyle,
  CustomCategory,
  CustomLayer,
  DisplayFeature,
  DisplayLegendItem,
  ForecastDay,
  GfcForecast,
  GeoJsonFeature,
  GeoJsonGeometry,
  MapView,
  ProbabilityBucket,
  PublicForecastResponse,
  RolledDay,
} from "./types";

const SYDNEY_TZ = "Australia/Sydney";
const PLACEHOLDER_LABEL = "placeholder";
const PLACEHOLDER_DATE_PREFIX = "2026-01-01";
export const MAX_FORECAST_DAYS = 5;

const CATEGORICAL_STYLES: Record<string, CategoryStyle> = {
  TSTM: {
    fillColor: "#a2c0b6",
    fillOpacity: 0.7,
    strokeColor: "#111827",
    strokeOpacity: 1,
    strokeWidth: 2,
    hatch: "none",
  },
  MRGL: {
    fillColor: "#90d89d",
    fillOpacity: 0.75,
    strokeColor: "#111827",
    strokeOpacity: 1,
    strokeWidth: 2,
    hatch: "none",
  },
  SLGT: {
    fillColor: "#ecf643",
    fillOpacity: 0.75,
    strokeColor: "#111827",
    strokeOpacity: 1,
    strokeWidth: 2,
    hatch: "none",
  },
  ENH: {
    fillColor: "#ffbc21",
    fillOpacity: 0.75,
    strokeColor: "#111827",
    strokeOpacity: 1,
    strokeWidth: 2,
    hatch: "none",
  },
  MDT: {
    fillColor: "#f80404",
    fillOpacity: 0.7,
    strokeColor: "#111827",
    strokeOpacity: 1,
    strokeWidth: 2,
    hatch: "none",
  },
  HIGH: {
    fillColor: "#fe3ab0",
    fillOpacity: 0.7,
    strokeColor: "#111827",
    strokeOpacity: 1,
    strokeWidth: 2,
    hatch: "none",
  },
};

const DEFAULT_MAP_VIEW: MapView = {
  center: [-25.5, 134.5],
  zoom: 4.5,
};

export function isGfcForecast(value: unknown): value is GfcForecast {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.timestamp !== "string") return false;
  if (!obj.forecastCycle || typeof obj.forecastCycle !== "object") return false;
  const cycle = obj.forecastCycle as Record<string, unknown>;
  if (!cycle.days || typeof cycle.days !== "object") return false;
  return true;
}

function sydneyDateParts(date: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SYDNEY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  return { y: get("year"), m: get("month"), d: get("day") };
}

function toUtcNoonFromParts(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

export function sydneyCalendarDate(isoOrDate: string | Date): Date {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  const { y, m, d } = sydneyDateParts(date);
  return toUtcNoonFromParts(y, m, d);
}

export function todaySydney(now = new Date()): Date {
  return sydneyCalendarDate(now);
}

function addCalendarDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

function isPlaceholderDate(value?: string): boolean {
  if (!value) return true;
  return value.startsWith(PLACEHOLDER_DATE_PREFIX);
}

function formatIsoDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

function formatDisplayDate(date: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

function stripPlaceholderCategories(categories: CustomCategory[]): CustomCategory[] {
  return categories
    .filter((c) => c.label.trim().toLowerCase() !== PLACEHOLDER_LABEL)
    .slice()
    .sort((a, b) => a.order - b.order);
}

function findAusRiskLayer(day: ForecastDay): CustomLayer | null {
  const layers = day.customLayers?.layers ?? [];
  const named = layers.find(
    (layer) => layer.label.trim().toLowerCase() === "ausrisk",
  );
  return named ?? layers[0] ?? null;
}

function geometryOf(feature: GeoJsonFeature): GeoJsonGeometry | null {
  if (!feature.geometry) return null;
  if (
    feature.geometry.type === "Polygon" ||
    feature.geometry.type === "MultiPolygon"
  ) {
    return feature.geometry;
  }
  return null;
}

function featuresFromCustomLayer(layer: CustomLayer): {
  features: DisplayFeature[];
  legend: DisplayLegendItem[];
} {
  const categories = stripPlaceholderCategories(layer.categories ?? []);
  const byId = new Map(categories.map((c) => [c.id, c]));

  const features: DisplayFeature[] = [];
  for (const feature of layer.features ?? []) {
    const geometry = geometryOf(feature);
    if (!geometry) continue;
    const categoryId = String(feature.properties?.categoryId ?? "");
    const category = byId.get(categoryId);
    if (!category) continue;
    // Always use the category legend label — never a stale feature title that
    // can disagree with categoryId (e.g. T-Storm geometry titled Low T-Storm).
    features.push({
      id: String(feature.id ?? `${categoryId}-${features.length}`),
      geometry,
      title: category.label,
      categoryId,
      order: category.order,
      style: category.style,
    });
  }

  // Ascending order so higher-risk categories paint above lower ones on the map.
  features.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

  const used = new Set(features.map((f) => f.categoryId));
  const legend: DisplayLegendItem[] = categories.map((c) => ({
    id: c.id,
    label: c.label,
    order: c.order,
    style: c.style,
    used: used.has(c.id),
  }));

  return { features, legend };
}

const CATEGORICAL_ORDER = ["TSTM", "MRGL", "SLGT", "ENH", "MDT", "HIGH"] as const;

function featuresFromCategorical(day: ForecastDay): {
  features: DisplayFeature[];
  legend: DisplayLegendItem[];
} {
  const buckets = day.data?.categorical ?? [];
  const legendMap = new Map<string, DisplayLegendItem>();
  const features: DisplayFeature[] = [];

  for (const bucket of buckets as ProbabilityBucket[]) {
    const [label, feats] = bucket;
    const style =
      CATEGORICAL_STYLES[label] ??
      ({
        fillColor: "#64748b",
        fillOpacity: 0.65,
        strokeColor: "#111827",
        strokeOpacity: 1,
        strokeWidth: 2,
        hatch: "none",
      } satisfies CategoryStyle);

    const order = CATEGORICAL_ORDER.indexOf(
      label as (typeof CATEGORICAL_ORDER)[number],
    );
    const resolvedOrder = order >= 0 ? order : legendMap.size + 100;

    if (!legendMap.has(label)) {
      legendMap.set(label, {
        id: label,
        label,
        order: resolvedOrder,
        style,
        used: true,
      });
    }

    for (const feature of feats) {
      const geometry = geometryOf(feature);
      if (!geometry) continue;
      features.push({
        id: String(feature.id ?? `${label}-${features.length}`),
        geometry,
        title: label,
        categoryId: label,
        order: resolvedOrder,
        style,
      });
    }
  }

  features.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

  return {
    features,
    legend: [...legendMap.values()].sort((a, b) => a.order - b.order),
  };
}

function resolveValidDate(day: ForecastDay, forecast: GfcForecast): Date {
  const metaDate = day.metadata?.validDate;
  if (!isPlaceholderDate(metaDate)) {
    return sydneyCalendarDate(metaDate!);
  }

  const cycleDate = forecast.forecastCycle.cycleDate;
  const base = !isPlaceholderDate(cycleDate)
    ? sydneyCalendarDate(cycleDate!)
    : sydneyCalendarDate(forecast.timestamp);

  return addCalendarDays(base, Math.max(0, day.day - 1));
}

function cleanDayLayers(day: ForecastDay): ForecastDay["customLayers"] {
  if (!day.customLayers) return undefined;
  return {
    ...day.customLayers,
    layers: (day.customLayers.layers ?? []).map((layer) => ({
      ...layer,
      categories: stripPlaceholderCategories(layer.categories ?? []),
    })),
  };
}

function stampDayDates(
  day: ForecastDay,
  dayNumber: number,
  today: Date,
): ForecastDay {
  return {
    ...day,
    day: dayNumber,
    metadata: {
      ...day.metadata,
      validDate: formatIsoDate(addCalendarDays(today, dayNumber - 1)),
      issueDate: formatIsoDate(today),
      lastModified: new Date().toISOString(),
    },
    customLayers: cleanDayLayers(day),
  };
}

function clampDay(n: number): number {
  return Math.min(MAX_FORECAST_DAYS, Math.max(1, Math.round(n)));
}

/**
 * Publish modes:
 * - replace: write file days starting at targetStartDay; keep other existing slots
 * - single: put only the first file day into targetStartDay; keep other slots
 */
export function normalizeForecastOnUpload(
  forecast: GfcForecast,
  options: {
    targetStartDay?: number;
    existing?: GfcForecast | null;
    now?: Date;
    mode?: "replace" | "single";
  } = {},
): GfcForecast {
  const today = todaySydney(options.now ?? new Date());
  const targetStartDay = clampDay(options.targetStartDay ?? 1);
  const mode = options.mode ?? "replace";

  const incoming = Object.values(forecast.forecastCycle.days)
    .map((day, index) => ({
      day,
      original: day.day ?? Number.NaN,
      index,
    }))
    .sort((a, b) => {
      const aDay = Number.isFinite(a.original) ? a.original : a.index + 1;
      const bDay = Number.isFinite(b.original) ? b.original : b.index + 1;
      return aDay - bDay;
    });

  if (!incoming.length) {
    throw new Error("Forecast file has no days to publish.");
  }

  const mergedDays: Record<string, ForecastDay> = {};

  // Always start from any already-published days so uploads do not wipe the cycle.
  if (options.existing?.forecastCycle?.days) {
    for (const [key, day] of Object.entries(options.existing.forecastCycle.days)) {
      const n = day.day ?? Number(key);
      if (!Number.isFinite(n) || n < 1 || n > MAX_FORECAST_DAYS) continue;
      mergedDays[String(n)] = stampDayDates(day, n, today);
    }
  }

  if (mode === "single") {
    const preferred =
      incoming.find((item) =>
        Boolean(
          item.day.customLayers?.layers?.some(
            (layer) => layer.label?.trim().toLowerCase() === "ausrisk",
          ),
        ),
      ) ?? incoming[0];
    mergedDays[String(targetStartDay)] = stampDayDates(
      preferred.day,
      targetStartDay,
      today,
    );
  } else {
    // Replace the slots this file covers; leave every other published day alone.
    let assigned = 0;
    for (const item of incoming) {
      const newDay = targetStartDay + assigned;
      assigned += 1;
      if (newDay > MAX_FORECAST_DAYS) break;
      mergedDays[String(newDay)] = stampDayDates(item.day, newDay, today);
    }
  }

  const base = options.existing ?? forecast;

  return {
    ...base,
    ...forecast,
    timestamp: new Date().toISOString(),
    mapView: forecast.mapView ?? base.mapView,
    forecastCycle: {
      ...base.forecastCycle,
      ...forecast.forecastCycle,
      currentDay: 1,
      cycleDate: formatIsoDate(today).slice(0, 10),
      days: mergedDays,
    },
  };
}

function dayTabLabel(effectiveDay: number, isToday: boolean): string {
  if (isToday || effectiveDay === 1) return "Today";
  return `Day ${effectiveDay}`;
}

export function rollForecast(
  forecast: GfcForecast,
  now = new Date(),
): PublicForecastResponse {
  const today = todaySydney(now);
  const rolled: RolledDay[] = [];

  for (const [key, day] of Object.entries(forecast.forecastCycle.days)) {
    const storedDay = day.day ?? Number(key);
    const validDate = resolveValidDate(day, forecast);
    const effectiveDay = calendarDaysBetween(today, validDate) + 1;
    if (effectiveDay < 1 || effectiveDay > MAX_FORECAST_DAYS) continue;

    const ausRisk = findAusRiskLayer(day);
    const built = ausRisk
      ? featuresFromCustomLayer(ausRisk)
      : featuresFromCategorical(day);

    const isToday = effectiveDay === 1;
    rolled.push({
      effectiveDay,
      storedDay,
      validDate: formatIsoDate(validDate),
      label: dayTabLabel(effectiveDay, isToday),
      dateLabel: formatDisplayDate(validDate),
      isToday,
      features: built.features,
      legend: built.legend,
      source: ausRisk ? "customLayers" : "categorical",
    });
  }

  rolled.sort((a, b) => a.effectiveDay - b.effectiveDay);

  const uniqueByEffective = new Map<number, RolledDay>();
  for (const day of rolled) {
    if (!uniqueByEffective.has(day.effectiveDay)) {
      uniqueByEffective.set(day.effectiveDay, day);
    }
  }
  const days = [...uniqueByEffective.values()];

  const defaultDay =
    days.find((d) => d.isToday)?.effectiveDay ??
    days[0]?.effectiveDay ??
    null;

  return {
    status: days.length ? "ok" : "empty",
    issuedAt: forecast.timestamp ?? null,
    mapView: forecast.mapView ?? DEFAULT_MAP_VIEW,
    days,
    defaultDay,
    message: days.length
      ? undefined
      : "No active outlook. Previous day risks have expired, or no forecast has been uploaded yet.",
  };
}

export { DEFAULT_MAP_VIEW };
