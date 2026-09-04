import { promises as fs } from "fs";
import path from "path";
import { del, list, put } from "@vercel/blob";
import type { GfcForecast } from "./types";
import { isGfcForecast } from "./process";

const DATA_DIR = path.join(process.cwd(), "data");
const FORECAST_PATH = path.join(DATA_DIR, "current-forecast.json");
const BLOB_PATHNAME = "ausrisk/current-forecast.json";

export function getForecastPath() {
  return FORECAST_PATH;
}

function useBlobStorage() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function readFromDisk(): Promise<GfcForecast | null> {
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

async function writeToDisk(forecast: GfcForecast): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FORECAST_PATH, JSON.stringify(forecast, null, 2), "utf8");
}

async function clearDisk(): Promise<void> {
  try {
    await fs.unlink(FORECAST_PATH);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw error;
  }
}

async function readFromBlob(): Promise<GfcForecast | null> {
  const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 10 });
  const match =
    blobs.find((b) => b.pathname === BLOB_PATHNAME) ?? blobs[0] ?? null;
  if (!match) return null;

  const res = await fetch(match.url, { cache: "no-store" });
  if (!res.ok) return null;
  const parsed = (await res.json()) as unknown;
  if (!isGfcForecast(parsed)) return null;
  return parsed;
}

async function writeToBlob(forecast: GfcForecast): Promise<void> {
  await put(BLOB_PATHNAME, JSON.stringify(forecast), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

async function clearBlob(): Promise<void> {
  const { blobs } = await list({ prefix: "ausrisk/", limit: 20 });
  const urls = blobs.map((b) => b.url);
  if (urls.length) await del(urls);
}

export async function readStoredForecast(): Promise<GfcForecast | null> {
  if (useBlobStorage()) {
    try {
      return await readFromBlob();
    } catch (error) {
      console.error("Blob read failed, falling back to disk", error);
    }
  }
  return readFromDisk();
}

export async function writeStoredForecast(forecast: GfcForecast): Promise<void> {
  if (useBlobStorage()) {
    await writeToBlob(forecast);
    return;
  }
  await writeToDisk(forecast);
}

export async function clearStoredForecast(): Promise<void> {
  if (useBlobStorage()) {
    await clearBlob();
    return;
  }
  await clearDisk();
}

export async function removeForecastDays(
  dayNumbers: number[],
): Promise<GfcForecast | null> {
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
