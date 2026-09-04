import { promises as fs } from "fs";
import path from "path";
import { del, get, list, put } from "@vercel/blob";
import type { GfcForecast } from "./types";
import { isGfcForecast } from "./process";

const DATA_DIR = path.join(process.cwd(), "data");
const FORECAST_PATH = path.join(DATA_DIR, "current-forecast.json");
const TMP_FORECAST_PATH = "/tmp/ausrisk-current-forecast.json";
const TMP_TOMBSTONE_PATH = "/tmp/ausrisk-forecast-cleared";
const BLOB_PATHNAME = "ausrisk/current-forecast.json";

type BlobAccess = "public" | "private";

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

function preferredAccessOrder(): BlobAccess[] {
  // Respect explicit override; otherwise try public then private.
  const forced = process.env.BLOB_ACCESS?.toLowerCase();
  if (forced === "private") return ["private"];
  if (forced === "public") return ["public"];
  return ["public", "private"];
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

async function writeRuntimeDisk(forecast: GfcForecast): Promise<void> {
  await fs.writeFile(TMP_FORECAST_PATH, JSON.stringify(forecast), "utf8");
  try {
    await fs.unlink(TMP_TOMBSTONE_PATH);
  } catch {
    // ignore
  }
}

async function readRuntimeDisk(): Promise<GfcForecast | null> {
  try {
    await fs.access(TMP_TOMBSTONE_PATH);
    return null;
  } catch {
    // no tombstone
  }
  return readJsonFile(TMP_FORECAST_PATH);
}

async function clearRuntimeDisk(): Promise<void> {
  try {
    await fs.unlink(TMP_FORECAST_PATH);
  } catch {
    // ignore
  }
  await fs.writeFile(TMP_TOMBSTONE_PATH, "1", "utf8");
}

async function streamToForecast(
  stream: ReadableStream<Uint8Array> | null,
): Promise<GfcForecast | null> {
  if (!stream) return null;
  const text = await new Response(stream).text();
  if (!text) return null;
  const parsed = JSON.parse(text) as unknown;
  if (!isGfcForecast(parsed)) return null;
  return parsed;
}

async function readFromBlob(): Promise<GfcForecast | null> {
  const errors: string[] = [];

  for (const access of preferredAccessOrder()) {
    try {
      const result = await get(BLOB_PATHNAME, {
        access,
        useCache: false,
      });
      if (!result || result.statusCode === 304) continue;
      const forecast = await streamToForecast(result.stream);
      if (forecast) return forecast;
    } catch (error) {
      errors.push(
        `get(${access}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Fallback: list then fetch (older behavior)
  try {
    const { blobs } = await list({ prefix: "ausrisk/", limit: 20 });
    const match =
      blobs.find((b) => b.pathname === BLOB_PATHNAME) ||
      blobs.find((b) => b.pathname.includes("current-forecast")) ||
      null;
    if (match) {
      const res = await fetch(match.url, { cache: "no-store" });
      if (res.ok) {
        const parsed = (await res.json()) as unknown;
        if (isGfcForecast(parsed)) return parsed;
      }
    }
  } catch (error) {
    errors.push(`list: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (errors.length) {
    console.error("Blob read attempts failed:", errors.join(" | "));
  }
  return null;
}

async function writeToBlob(forecast: GfcForecast): Promise<void> {
  const body = JSON.stringify(forecast);
  const errors: string[] = [];

  for (const access of preferredAccessOrder()) {
    try {
      await put(BLOB_PATHNAME, body, {
        access,
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return;
    } catch (error) {
      errors.push(
        `put(${access}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  throw new Error(
    `Blob write failed. ${errors.join(" | ")}. Check Blob store access mode and tokens.`,
  );
}

async function clearBlob(): Promise<void> {
  const { blobs } = await list({ prefix: "ausrisk/", limit: 50 });
  const urls = blobs.map((b) => b.url);
  if (urls.length) await del(urls);
}

async function readFromDisk(): Promise<GfcForecast | null> {
  if (process.env.VERCEL) {
    return readRuntimeDisk();
  }
  return readJsonFile(FORECAST_PATH);
}

async function writeToDisk(forecast: GfcForecast): Promise<void> {
  if (process.env.VERCEL) {
    await writeRuntimeDisk(forecast);
    return;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FORECAST_PATH, JSON.stringify(forecast, null, 2), "utf8");
}

async function clearDisk(): Promise<void> {
  if (process.env.VERCEL) {
    await clearRuntimeDisk();
    return;
  }
  try {
    await fs.unlink(FORECAST_PATH);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw error;
  }
}

export async function readStoredForecast(): Promise<GfcForecast | null> {
  if (useBlobStorage()) {
    const fromBlob = await readFromBlob();
    if (fromBlob) return fromBlob;

    // Same serverless instance may have a fresh write mirrored to /tmp
    if (process.env.VERCEL) {
      const fromTmp = await readRuntimeDisk();
      if (fromTmp) return fromTmp;
    }
    return null;
  }
  return readFromDisk();
}

export async function writeStoredForecast(forecast: GfcForecast): Promise<void> {
  if (useBlobStorage()) {
    await writeToBlob(forecast);
    // Mirror for same-instance reads right after upload
    if (process.env.VERCEL) {
      try {
        await writeRuntimeDisk(forecast);
      } catch {
        // non-fatal
      }
    }

    // Verify the blob is readable so admin gets a real error if storage is broken
    const verify = await readFromBlob();
    if (!verify) {
      throw new Error(
        "Forecast was written but could not be read back from Blob. Check that the Blob store access mode matches (public/private) and redeploy.",
      );
    }
    return;
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
    } catch (error) {
      console.error("Blob clear failed", error);
      throw new Error(
        `Blob clear failed. ${error instanceof Error ? error.message : ""}`,
      );
    }
    if (process.env.VERCEL) {
      await clearRuntimeDisk();
    }
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
