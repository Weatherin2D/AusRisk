import { promises as fs } from "fs";
import path from "path";
import { del, list, put } from "@vercel/blob";
import type { GfcForecast } from "./types";
import { isGfcForecast } from "./process";

const DATA_DIR = path.join(process.cwd(), "data");
const FORECAST_PATH = path.join(DATA_DIR, "current-forecast.json");
const TMP_FORECAST_PATH = "/tmp/ausrisk-current-forecast.json";
const TMP_TOMBSTONE_PATH = "/tmp/ausrisk-forecast-cleared";
const BLOB_PATHNAME = "ausrisk/current-forecast.json";

export function getForecastPath() {
  return FORECAST_PATH;
}

/** True when Vercel Blob credentials are available (static token or OIDC). */
export function useBlobStorage() {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      process.env.BLOB_STORE_ID ||
      (process.env.VERCEL && process.env.VERCEL_OIDC_TOKEN),
  );
}

function diskWritePath() {
  return process.env.VERCEL ? TMP_FORECAST_PATH : FORECAST_PATH;
}

async function readJsonFile(filePath: string): Promise<GfcForecast | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isGfcForecast(parsed)) return null;
    return parsed;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    throw error;
  }
}

async function readFromDisk(): Promise<GfcForecast | null> {
  if (process.env.VERCEL) {
    try {
      await fs.access(TMP_TOMBSTONE_PATH);
      return null;
    } catch {
      // no tombstone
    }
    const fromTmp = await readJsonFile(TMP_FORECAST_PATH);
    if (fromTmp) return fromTmp;
  }
  return readJsonFile(FORECAST_PATH);
}

async function writeToDisk(forecast: GfcForecast): Promise<void> {
  const target = diskWritePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(forecast, null, 2), "utf8");
  if (process.env.VERCEL) {
    try {
      await fs.unlink(TMP_TOMBSTONE_PATH);
    } catch {
      // ignore
    }
  }
}

async function clearDisk(): Promise<void> {
  for (const filePath of [diskWritePath(), FORECAST_PATH]) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") throw error;
    }
  }
  if (process.env.VERCEL) {
    await fs.writeFile(TMP_TOMBSTONE_PATH, "1", "utf8");
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
  const { blobs } = await list({ prefix: "ausrisk/", limit: 50 });
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
    try {
      await writeToBlob(forecast);
      return;
    } catch (error) {
      console.error("Blob write failed", error);
      throw new Error(
        `Blob write failed. Check Blob store connection / BLOB_READ_WRITE_TOKEN. ${
          error instanceof Error ? error.message : ""
        }`,
      );
    }
  }

  try {
    await writeToDisk(forecast);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EROFS" || err.code === "EACCES" || process.env.VERCEL) {
      throw new Error(
        "Forecast storage is not writable. Create a Vercel Blob store and reconnect it to this project, then redeploy.",
      );
    }
    throw error;
  }
}

export async function clearStoredForecast(): Promise<void> {
  if (useBlobStorage()) {
    try {
      await clearBlob();
      return;
    } catch (error) {
      console.error("Blob clear failed", error);
      throw new Error(
        `Blob clear failed. ${error instanceof Error ? error.message : ""}`,
      );
    }
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
