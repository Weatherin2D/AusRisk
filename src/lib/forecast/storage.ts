import { promises as fs } from "fs";
import path from "path";
import type { GfcForecast } from "./types";
import { isGfcForecast } from "./process";

const DATA_DIR = path.join(process.cwd(), "data");
const FORECAST_PATH = path.join(DATA_DIR, "current-forecast.json");

export function getForecastPath() {
  return FORECAST_PATH;
}

export async function readStoredForecast(): Promise<GfcForecast | null> {
  try {
    const raw = await fs.readFile(FORECAST_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isGfcForecast(parsed)) return null;
    return parsed;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeStoredForecast(forecast: GfcForecast): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FORECAST_PATH, JSON.stringify(forecast, null, 2), "utf8");
}

export async function clearStoredForecast(): Promise<void> {
  try {
    await fs.unlink(FORECAST_PATH);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw error;
  }
}

export async function removeForecastDays(dayNumbers: number[]): Promise<GfcForecast | null> {
  const forecast = await readStoredForecast();
  if (!forecast) return null;

  const remove = new Set(dayNumbers.map((n) => String(n)));
  const days = { ...forecast.forecastCycle.days };
  for (const key of Object.keys(days)) {
    const dayNum = days[key]?.day ?? Number(key);
    if (remove.has(String(dayNum)) || remove.has(key)) {
      delete days[key];
    }
  }

  if (Object.keys(days).length === 0) {
    await clearStoredForecast();
    return null;
  }

  const next: GfcForecast = {
    ...forecast,
    timestamp: new Date().toISOString(),
    forecastCycle: {
      ...forecast.forecastCycle,
      days,
    },
  };
  await writeStoredForecast(next);
  return next;
}
