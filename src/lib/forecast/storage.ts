import { promises as fs } from "fs";
import path from "path";
import { del, get, list, put, type PutBlobResult } from "@vercel/blob";
import type { GfcForecast } from "./types";
import { isGfcForecast } from "./process";

const DATA_DIR = path.join(process.cwd(), "data");
const FORECAST_PATH = path.join(DATA_DIR, "current-forecast.json");
const TMP_FORECAST_PATH = "/tmp/ausrisk-current-forecast.json";
const TMP_TOMBSTONE_PATH = "/tmp/ausrisk-forecast-cleared";

/** Legacy single mutable object — kept only for one-time migration reads. */
const LEGACY_BLOB_PATHNAME = "ausrisk/current-forecast.json";
const LEGACY_LATEST_PATH = "ausrisk/latest.json";
const META_PREFIX = "ausrisk/meta/";
const FORECAST_OBJECT_PREFIX = "ausrisk/forecasts/";
const BLOB_PREFIX = "ausrisk/";

type BlobAccess = "public" | "private";

type MetaRecord =
  | { kind: "cleared"; updatedAt: string }
  | {
      kind: "active";
      pathname: string;
      url: string;
      timestamp: string;
      updatedAt: string;
    };

type BlobRead =
  | { kind: "cleared" }
  | { kind: "forecast"; forecast: GfcForecast }
  | { kind: "absent" };

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

function versionId(seed?: string): string {
  const base = (seed ?? new Date().toISOString()).replace(/[:.]/g, "-");
  const nonce = Math.random().toString(36).slice(2, 10);
  return `${base}-${nonce}`;
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
): Promise<PutBlobResult> {
  const body = JSON.stringify(value);
  const errors: string[] = [];

  for (const access of preferredAccessOrder()) {
    try {
      return await put(pathname, body, {
        access,
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: false,
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
  for (const access of preferredAccessOrder()) {
    try {
      const result = await get(pathname, {
        access,
        useCache: false,
      });
      if (!result || result.statusCode === 304) continue;
      return await streamToJson(result.stream);
    } catch {
      // try next access mode
    }
  }
  return null;
}

/** Fetch an immutable put() URL, busting any edge cache. */
async function fetchJsonFromUrl(
  url: string,
  attempts = 5,
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as unknown;
    } catch (error) {
      lastError = error;
      await sleep(120 * (i + 1));
    }
  }
  console.error("fetchJsonFromUrl failed", lastError);
  return null;
}

function parseMeta(value: unknown): MetaRecord | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (obj.kind === "cleared" && typeof obj.updatedAt === "string") {
    return { kind: "cleared", updatedAt: obj.updatedAt };
  }
  if (
    obj.kind === "active" &&
    typeof obj.pathname === "string" &&
    typeof obj.url === "string" &&
    typeof obj.timestamp === "string" &&
    typeof obj.updatedAt === "string"
  ) {
    return {
      kind: "active",
      pathname: obj.pathname,
      url: obj.url,
      timestamp: obj.timestamp,
      updatedAt: obj.updatedAt,
    };
  }
  // Legacy pointer shapes from the previous fix attempt
  if (obj.cleared === true && typeof obj.updatedAt === "string") {
    return { kind: "cleared", updatedAt: obj.updatedAt };
  }
  if (
    obj.cleared !== true &&
    typeof obj.pathname === "string" &&
    typeof obj.url === "string" &&
    typeof obj.timestamp === "string"
  ) {
    return {
      kind: "active",
      pathname: obj.pathname,
      url: obj.url,
      timestamp: obj.timestamp,
      updatedAt:
        typeof obj.updatedAt === "string"
          ? obj.updatedAt
          : new Date(0).toISOString(),
    };
  }
  return null;
}

async function listBlobs(prefix: string) {
  let cursor: string | undefined;
  const blobs: {
    url: string;
    pathname: string;
    uploadedAt: Date;
  }[] = [];

  do {
    const page = await list({
      prefix,
      cursor,
      limit: 100,
    });
    for (const blob of page.blobs) {
      blobs.push({
        url: blob.url,
        pathname: blob.pathname,
        uploadedAt: blob.uploadedAt,
      });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return blobs;
}

async function deleteUrls(urls: string[]): Promise<void> {
  if (!urls.length) return;
  for (let i = 0; i < urls.length; i += 50) {
    await del(urls.slice(i, i + 50));
  }
}

async function deleteAllUnder(prefix: string): Promise<void> {
  try {
    const blobs = await listBlobs(prefix);
    await deleteUrls(blobs.map((b) => b.url));
  } catch (error) {
    console.error(`Blob delete under ${prefix} failed (continuing)`, error);
  }
}

/**
 * Authoritative meta is the newest object under ausrisk/meta/.
 * Each publish/wipe writes a NEW pathname so CDN cannot serve a stale overwrite.
 */
async function readNewestMeta(): Promise<MetaRecord | null> {
  try {
    const metas = await listBlobs(META_PREFIX);
    if (!metas.length) return null;
    metas.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());

    for (const blob of metas) {
      const json =
        (await fetchJsonFromUrl(blob.url)) ??
        (await getJsonByPathname(blob.pathname));
      const meta = parseMeta(json);
      if (meta) return meta;
    }
  } catch (error) {
    console.error("readNewestMeta failed", error);
  }
  return null;
}

async function readLegacyForecast(): Promise<GfcForecast | null> {
  const parsed = await getJsonByPathname(LEGACY_BLOB_PATHNAME);
  if (isGfcForecast(parsed)) return parsed;

  try {
    const blobs = await listBlobs(LEGACY_BLOB_PATHNAME);
    const match = blobs.find((b) => b.pathname === LEGACY_BLOB_PATHNAME);
    if (!match) return null;
    const fromUrl = await fetchJsonFromUrl(match.url);
    return isGfcForecast(fromUrl) ? fromUrl : null;
  } catch {
    return null;
  }
}

async function readLegacyLatestPointer(): Promise<MetaRecord | null> {
  const parsed = parseMeta(await getJsonByPathname(LEGACY_LATEST_PATH));
  if (parsed) return parsed;
  try {
    const blobs = await listBlobs(LEGACY_LATEST_PATH);
    const match = blobs.find((b) => b.pathname === LEGACY_LATEST_PATH);
    if (!match) return null;
    return parseMeta(await fetchJsonFromUrl(match.url));
  } catch {
    return null;
  }
}

async function readFromBlob(): Promise<BlobRead> {
  const meta = (await readNewestMeta()) ?? (await readLegacyLatestPointer());

  if (meta?.kind === "cleared") {
    return { kind: "cleared" };
  }

  if (meta?.kind === "active") {
    const fromUrl = await fetchJsonFromUrl(meta.url);
    if (isGfcForecast(fromUrl)) {
      return { kind: "forecast", forecast: fromUrl };
    }
    const fromPath = await getJsonByPathname(meta.pathname);
    if (isGfcForecast(fromPath)) {
      return { kind: "forecast", forecast: fromPath };
    }
    // Active meta but object gone — treat as empty, never revive legacy test data.
    return { kind: "cleared" };
  }

  const legacy = await readLegacyForecast();
  if (legacy) return { kind: "forecast", forecast: legacy };
  return { kind: "absent" };
}

async function writeMeta(meta: MetaRecord): Promise<PutBlobResult> {
  const pathname = `${META_PREFIX}${versionId(meta.updatedAt)}.json`;
  return putJson(pathname, meta);
}

async function writeToBlob(forecast: GfcForecast): Promise<void> {
  const forecastPath = `${FORECAST_OBJECT_PREFIX}${versionId(forecast.timestamp)}.json`;
  const object = await putJson(forecastPath, forecast);

  const updatedAt = new Date().toISOString();
  const meta: MetaRecord = {
    kind: "active",
    pathname: object.pathname,
    url: object.url,
    timestamp: forecast.timestamp,
    updatedAt,
  };
  const metaPut = await writeMeta(meta);

  // Verify via immutable put URLs
  let verified = await fetchJsonFromUrl(object.url);
  if (!isGfcForecast(verified) || verified.timestamp !== forecast.timestamp) {
    await sleep(200);
    verified = await fetchJsonFromUrl(object.url);
  }
  if (!isGfcForecast(verified) || verified.timestamp !== forecast.timestamp) {
    const viaGet = await getJsonByPathname(object.pathname);
    if (!isGfcForecast(viaGet) || viaGet.timestamp !== forecast.timestamp) {
      throw new Error(
        "Forecast was written but could not be verified in Blob. Wait a moment and refresh; if it stays wrong, wipe-all then publish again.",
      );
    }
  }

  const metaCheck =
    (await fetchJsonFromUrl(metaPut.url)) ??
    (await getJsonByPathname(metaPut.pathname));
  if (parseMeta(metaCheck)?.kind !== "active") {
    await writeMeta(meta);
  }

  // Remove older metas/forecasts/legacy so nothing can resurrect the test file.
  // Keep only the just-written pair.
  try {
    const all = await listBlobs(BLOB_PREFIX);
    const keepPathnames = new Set([object.pathname, metaPut.pathname]);
    const stale = all
      .filter((b) => !keepPathnames.has(b.pathname))
      .map((b) => b.url);
    await deleteUrls(stale);
  } catch (error) {
    console.error("Blob cleanup failed (non-fatal)", error);
  }
}

async function clearBlob(): Promise<void> {
  const updatedAt = new Date().toISOString();
  const metaPut = await writeMeta({ kind: "cleared", updatedAt });

  // Delete everything else under ausrisk/, then keep/reassert this cleared meta.
  try {
    const all = await listBlobs(BLOB_PREFIX);
    const stale = all
      .filter((b) => b.url !== metaPut.url && b.pathname !== metaPut.pathname)
      .map((b) => b.url);
    await deleteUrls(stale);
  } catch (error) {
    console.error("Blob clear delete failed (continuing)", error);
    await deleteAllUnder(FORECAST_OBJECT_PREFIX);
    await deleteAllUnder(LEGACY_BLOB_PATHNAME);
  }

  // If the cleared meta was swept somehow, write another unique cleared record.
  const newest = await readNewestMeta();
  if (newest?.kind !== "cleared") {
    await writeMeta({ kind: "cleared", updatedAt: new Date().toISOString() });
  }
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
