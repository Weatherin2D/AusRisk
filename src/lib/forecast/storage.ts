import { promises as fs } from "fs";
import path from "path";
import { del, get, list, put, type PutBlobResult } from "@vercel/blob";
import type { GfcForecast } from "./types";
import { isGfcForecast } from "./process";

const DATA_DIR = path.join(process.cwd(), "data");
const FORECAST_PATH = path.join(DATA_DIR, "current-forecast.json");
const TMP_FORECAST_PATH = "/tmp/ausrisk-current-forecast.json";
const TMP_TOMBSTONE_PATH = "/tmp/ausrisk-forecast-cleared";

/** Legacy single mutable object (CDN-cached overwrites caused stale “test” outlooks). */
const LEGACY_BLOB_PATHNAME = "ausrisk/current-forecast.json";
/** Small pointer blob — always rewritten on publish/wipe. */
const LATEST_POINTER_PATH = "ausrisk/latest.json";
const FORECAST_OBJECT_PREFIX = "ausrisk/forecasts/";
const BLOB_PREFIX = "ausrisk/";

type BlobAccess = "public" | "private";

type LatestPointer =
  | { cleared: true; updatedAt: string }
  | {
      cleared?: false;
      pathname: string;
      url: string;
      timestamp: string;
      updatedAt: string;
    };

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
  const forced = process.env.BLOB_ACCESS?.toLowerCase();
  if (forced === "private") return ["private"];
  if (forced === "public") return ["public"];
  return ["public", "private"];
}

function noStoreHeaders(): HeadersInit {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function streamToJson(
  stream: ReadableStream<Uint8Array> | null,
): Promise<unknown | null> {
  if (!stream) return null;
  const text = await new Response(stream).text();
  if (!text) return null;
  return JSON.parse(text) as unknown;
}

async function putJson(
  pathname: string,
  value: unknown,
  opts?: { addRandomSuffix?: boolean },
): Promise<PutBlobResult> {
  const body = JSON.stringify(value);
  const errors: string[] = [];

  for (const access of preferredAccessOrder()) {
    try {
      return await put(pathname, body, {
        access,
        contentType: "application/json",
        addRandomSuffix: opts?.addRandomSuffix ?? false,
        allowOverwrite: true,
        // Mutable pointer must not sit in CDN for minutes
        cacheControlMaxAge: 0,
      });
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

async function getJsonByPathname(pathname: string): Promise<unknown | null> {
  const errors: string[] = [];

  for (const access of preferredAccessOrder()) {
    try {
      const result = await get(pathname, {
        access,
        useCache: false,
      });
      if (!result || result.statusCode === 304) continue;
      return await streamToJson(result.stream);
    } catch (error) {
      errors.push(
        `get(${access}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (errors.length) {
    console.error("Blob get failed:", errors.join(" | "));
  }
  return null;
}

/** Fetch a blob URL returned by put(), busting any CDN edge cache. */
async function fetchJsonFromUrl(
  url: string,
  attempts = 4,
): Promise<unknown | null> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const bust = `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}-${i}`;
      const res = await fetch(bust, {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return (await res.json()) as unknown;
    } catch (error) {
      lastError = error;
      await sleep(150 * (i + 1));
    }
  }
  console.error("fetchJsonFromUrl failed", lastError);
  return null;
}

function isClearedPointer(
  value: unknown,
): value is Extract<LatestPointer, { cleared: true }> {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { cleared?: unknown }).cleared === true,
  );
}

function isActivePointer(
  value: unknown,
): value is Extract<LatestPointer, { pathname: string }> {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    obj.cleared !== true &&
    typeof obj.pathname === "string" &&
    typeof obj.url === "string" &&
    typeof obj.timestamp === "string"
  );
}

async function listAllUrls(prefix: string): Promise<string[]> {
  let cursor: string | undefined;
  const urls: string[] = [];

  do {
    const page = await list({
      prefix,
      cursor,
      limit: 100,
    });
    for (const blob of page.blobs) {
      urls.push(blob.url);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return urls;
}

async function deleteUrls(urls: string[]): Promise<void> {
  if (!urls.length) return;
  for (let i = 0; i < urls.length; i += 50) {
    await del(urls.slice(i, i + 50));
  }
}

/** Best-effort wipe of every object under ausrisk/. */
async function clearAllBlobsBestEffort(): Promise<void> {
  try {
    const urls = await listAllUrls(BLOB_PREFIX);
    await deleteUrls(urls);
  } catch (error) {
    console.error("Blob list/delete failed (continuing)", error);
  }
}

async function readLegacyForecast(): Promise<GfcForecast | null> {
  const parsed = await getJsonByPathname(LEGACY_BLOB_PATHNAME);
  if (isGfcForecast(parsed)) return parsed;

  try {
    const { blobs } = await list({ prefix: LEGACY_BLOB_PATHNAME, limit: 10 });
    const match = blobs.find((b) => b.pathname === LEGACY_BLOB_PATHNAME);
    if (!match) return null;
    const fromUrl = await fetchJsonFromUrl(match.url);
    return isGfcForecast(fromUrl) ? fromUrl : null;
  } catch {
    return null;
  }
}

async function readPointer(): Promise<LatestPointer | null> {
  const fromGet = await getJsonByPathname(LATEST_POINTER_PATH);
  if (isClearedPointer(fromGet) || isActivePointer(fromGet)) {
    return fromGet;
  }

  try {
    const { blobs } = await list({ prefix: LATEST_POINTER_PATH, limit: 5 });
    const match = blobs.find((b) => b.pathname === LATEST_POINTER_PATH);
    if (!match) return null;
    const fromUrl = await fetchJsonFromUrl(match.url);
    if (isClearedPointer(fromUrl) || isActivePointer(fromUrl)) {
      return fromUrl;
    }
  } catch (error) {
    console.error("Pointer list/fetch failed", error);
  }
  return null;
}

type BlobRead =
  | { kind: "cleared" }
  | { kind: "forecast"; forecast: GfcForecast }
  | { kind: "absent" };

async function readFromBlob(): Promise<BlobRead> {
  const pointer = await readPointer();

  if (isClearedPointer(pointer)) {
    return { kind: "cleared" };
  }

  if (isActivePointer(pointer)) {
    // Prefer the exact URL from the last successful put (cache-busted)
    const fromUrl = await fetchJsonFromUrl(pointer.url);
    if (isGfcForecast(fromUrl) && fromUrl.timestamp === pointer.timestamp) {
      return { kind: "forecast", forecast: fromUrl };
    }

    const fromPath = await getJsonByPathname(pointer.pathname);
    if (isGfcForecast(fromPath)) {
      return { kind: "forecast", forecast: fromPath };
    }

    // Pointer exists but object missing — empty, do not revive legacy/tmp.
    return { kind: "cleared" };
  }

  // Migration: no pointer yet → try legacy mutable pathname once
  const legacy = await readLegacyForecast();
  if (legacy) return { kind: "forecast", forecast: legacy };
  return { kind: "absent" };
}

function versionedForecastPath(timestamp: string): string {
  const safe = timestamp.replace(/[:.]/g, "-");
  const nonce = Math.random().toString(36).slice(2, 8);
  return `${FORECAST_OBJECT_PREFIX}${safe}-${nonce}.json`;
}

async function writeToBlob(forecast: GfcForecast): Promise<void> {
  const pathname = versionedForecastPath(forecast.timestamp);
  const object = await putJson(pathname, forecast);

  const pointer: LatestPointer = {
    cleared: false,
    pathname: object.pathname,
    url: object.url,
    timestamp: forecast.timestamp,
    updatedAt: new Date().toISOString(),
  };

  const pointerPut = await putJson(LATEST_POINTER_PATH, pointer);

  // Verify via the put URL itself (not a CDN-cached mutable pathname)
  let verified: unknown | null = await fetchJsonFromUrl(object.url);
  if (!isGfcForecast(verified) || verified.timestamp !== forecast.timestamp) {
    // Brief retry — origin can lag a moment after put
    await sleep(250);
    verified = await fetchJsonFromUrl(object.url);
  }

  if (!isGfcForecast(verified) || verified.timestamp !== forecast.timestamp) {
    // Last resort: pathname get with useCache:false
    const viaGet = await getJsonByPathname(object.pathname);
    if (!isGfcForecast(viaGet) || viaGet.timestamp !== forecast.timestamp) {
      throw new Error(
        "Forecast was written but could not be verified in Blob. Wait a moment and refresh; if it stays wrong, wipe-all then publish again.",
      );
    }
  }

  // Confirm pointer points at this version
  const pointerCheck =
    (await fetchJsonFromUrl(pointerPut.url)) ??
    (await getJsonByPathname(LATEST_POINTER_PATH));
  if (
    !isActivePointer(pointerCheck) ||
    pointerCheck.timestamp !== forecast.timestamp
  ) {
    // Re-put pointer once more
    await putJson(LATEST_POINTER_PATH, pointer);
  }

  // Best-effort: remove legacy mutable file + older versioned objects so the
  // old test outlook cannot be served by any fallback path.
  try {
    const urls = await listAllUrls(BLOB_PREFIX);
    const keep = new Set([object.url, pointerPut.url]);
    // pointerPut.url may differ after rewrite — also keep by pathname match
    const stale = urls.filter((url) => {
      if (keep.has(url)) return false;
      if (url.includes(object.pathname)) return false;
      if (url.includes(LATEST_POINTER_PATH)) return false;
      return true;
    });
    await deleteUrls(stale);
  } catch (error) {
    console.error("Blob cleanup failed (non-fatal)", error);
  }
}

async function clearBlob(): Promise<void> {
  const clearedAt = new Date().toISOString();
  const tombstone: LatestPointer = {
    cleared: true,
    updatedAt: clearedAt,
  };

  // Write the cleared pointer FIRST so readers stop serving old JSON even if
  // deletes are slow or CDN still has previous forecast objects.
  await putJson(LATEST_POINTER_PATH, tombstone);
  await clearAllBlobsBestEffort();
  // Re-assert tombstone after wipe (delete may have removed the pointer)
  await putJson(LATEST_POINTER_PATH, tombstone);
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
    if (fromBlob.kind === "cleared") return null;
    if (fromBlob.kind === "forecast") return fromBlob.forecast;

    // No pointer and no legacy blob — same-instance /tmp only (never after wipe)
    if (process.env.VERCEL) {
      return readRuntimeDisk();
    }
    return null;
  }
  return readFromDisk();
}

export async function writeStoredForecast(forecast: GfcForecast): Promise<void> {
  if (useBlobStorage()) {
    await writeToBlob(forecast);
    if (process.env.VERCEL) {
      try {
        await writeRuntimeDisk(forecast);
      } catch {
        // non-fatal
      }
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

export { noStoreHeaders };
