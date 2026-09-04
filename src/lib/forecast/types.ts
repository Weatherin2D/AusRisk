export type GeoJsonGeometry =
  | {
      type: "Polygon";
      coordinates: number[][][];
    }
  | {
      type: "MultiPolygon";
      coordinates: number[][][][];
    };

export type GeoJsonFeature = {
  type: "Feature";
  id?: string;
  geometry: GeoJsonGeometry | null;
  properties: Record<string, unknown>;
};

export type CategoryStyle = {
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
  hatch?: string;
};

export type CustomCategory = {
  id: string;
  label: string;
  order: number;
  style: CategoryStyle;
};

export type CustomLayer = {
  schemaVersion?: string;
  id: string;
  label: string;
  order: number;
  categories: CustomCategory[];
  features: GeoJsonFeature[];
};

export type CustomLayers = {
  schemaVersion?: string;
  layers: CustomLayer[];
};

export type ProbabilityBucket = [string, GeoJsonFeature[]];

export type DayData = {
  tornado?: ProbabilityBucket[];
  wind?: ProbabilityBucket[];
  hail?: ProbabilityBucket[];
  categorical?: ProbabilityBucket[];
};

export type DayMetadata = {
  issueDate?: string;
  validDate?: string;
  issuanceTime?: string;
  lowProbabilityOutlooks?: string[];
  createdAt?: string;
  lastModified?: string;
};

export type ForecastDay = {
  day: number;
  metadata: DayMetadata;
  data: DayData;
  customLayers?: CustomLayers;
};

export type ForecastCycle = {
  days: Record<string, ForecastDay>;
  currentDay?: number;
  cycleDate?: string;
};

export type MapView = {
  center: [number, number];
  zoom: number;
};

export type GfcForecast = {
  version?: string;
  type: string;
  timestamp: string;
  forecastCycle: ForecastCycle;
  mapView?: MapView;
};

export type DisplayFeature = {
  id: string;
  geometry: GeoJsonGeometry;
  title: string;
  categoryId: string;
  /** Legend/category order — lower draws first, higher risk paints on top. */
  order: number;
  style: CategoryStyle;
};

export type DisplayLegendItem = {
  id: string;
  label: string;
  order: number;
  style: CategoryStyle;
};

export type RolledDay = {
  effectiveDay: number;
  storedDay: number;
  validDate: string;
  label: string;
  dateLabel: string;
  isToday: boolean;
  features: DisplayFeature[];
  legend: DisplayLegendItem[];
  source: "customLayers" | "categorical";
};

export type PublicForecastResponse = {
  status: "ok" | "empty";
  issuedAt: string | null;
  mapView: MapView;
  days: RolledDay[];
  defaultDay: number | null;
  message?: string;
};
