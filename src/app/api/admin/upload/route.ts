import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import {
  isGfcForecast,
  MAX_FORECAST_DAYS,
  normalizeForecastOnUpload,
} from "@/lib/forecast/process";
import {
  readStoredForecast,
  writeStoredForecast,
} from "@/lib/forecast/storage";

function parseTargetDay(value: unknown): number {
  const n = Number(value ?? 1);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_FORECAST_DAYS, Math.max(1, Math.round(n)));
}

function parseMode(value: unknown): "replace" | "single" {
  const raw = String(value ?? "replace").toLowerCase();
  return raw === "single" ? "single" : "replace";
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const contentType = request.headers.get("content-type") ?? "";
    let parsed: unknown;
    let targetStartDay = 1;
    let mode: "replace" | "single" = "replace";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Missing file" }, { status: 400 });
      }
      targetStartDay = parseTargetDay(form.get("targetDay"));
      // Back-compat: replaceAll=true/false → replace/single-ish
      if (form.has("mode")) {
        mode = parseMode(form.get("mode"));
      } else if (String(form.get("replaceAll") ?? "true") === "false") {
        mode = "single";
      } else {
        mode = "replace";
      }
      const text = await file.text();
      parsed = JSON.parse(text);
    } else {
      const body = (await request.json()) as {
        forecast?: unknown;
        targetDay?: number;
        replaceAll?: boolean;
        mode?: string;
      };
      parsed = body.forecast ?? body;
      targetStartDay = parseTargetDay(body.targetDay);
      if (body.mode) {
        mode = parseMode(body.mode);
      } else if (body.replaceAll === false) {
        mode = "single";
      } else {
        mode = "replace";
      }
    }

    if (!isGfcForecast(parsed)) {
      return NextResponse.json(
        {
          error:
            "Invalid forecast file. Expected a GFC forecast-cycle JSON with forecastCycle.days.",
        },
        { status: 400 },
      );
    }

    if (parsed.type && parsed.type !== "forecast-cycle") {
      return NextResponse.json(
        { error: `Unexpected type "${parsed.type}". Expected forecast-cycle.` },
        { status: 400 },
      );
    }

    const existing =
      mode === "single" ? await readStoredForecast() : null;
    const normalized = normalizeForecastOnUpload(parsed, {
      targetStartDay,
      existing,
      mode,
    });
    await writeStoredForecast(normalized);

    const dayCount = Object.keys(normalized.forecastCycle.days).length;
    return NextResponse.json({
      ok: true,
      dayCount,
      targetStartDay,
      mode,
      days: Object.keys(normalized.forecastCycle.days)
        .map(Number)
        .sort((a, b) => a - b),
      issuedAt: normalized.timestamp,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Upload failed. Check that the file is valid JSON.",
      },
      { status: 400 },
    );
  }
}
