import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { MAX_FORECAST_DAYS } from "@/lib/forecast/process";
import {
  clearStoredForecast,
  readStoredForecast,
  removeForecastDays,
} from "@/lib/forecast/storage";

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const forecast = await readStoredForecast();
  if (!forecast) {
    return NextResponse.json({ days: [], issuedAt: null });
  }

  const days = Object.values(forecast.forecastCycle.days)
    .map((day) => ({
      day: day.day,
      validDate: day.metadata?.validDate ?? null,
      hasCustomLayer: Boolean(day.customLayers?.layers?.length),
    }))
    .sort((a, b) => a.day - b.day);

  return NextResponse.json({
    days,
    issuedAt: forecast.timestamp ?? null,
    maxDays: MAX_FORECAST_DAYS,
  });
}

export async function DELETE(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const wipe = url.searchParams.get("wipe") === "all";
    let dayNumbers: number[] = [];

    if (wipe) {
      await clearStoredForecast();
      return NextResponse.json({ ok: true, wiped: true, days: [] });
    }

    const body = await request.json().catch(() => ({}));
    if (Array.isArray(body.days)) {
      dayNumbers = body.days.map((n: unknown) => Number(n)).filter(Number.isFinite);
    } else if (body.day != null) {
      dayNumbers = [Number(body.day)].filter(Number.isFinite);
    } else if (url.searchParams.has("day")) {
      dayNumbers = [Number(url.searchParams.get("day"))].filter(Number.isFinite);
    }

    if (!dayNumbers.length) {
      return NextResponse.json(
        { error: "Specify day, days[], or wipe=all" },
        { status: 400 },
      );
    }

    const next = await removeForecastDays(dayNumbers);
    const remaining = next
      ? Object.values(next.forecastCycle.days)
          .map((d) => d.day)
          .sort((a, b) => a - b)
      : [];

    return NextResponse.json({
      ok: true,
      removed: dayNumbers,
      days: remaining,
      wiped: remaining.length === 0,
    });
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error ? error.message : "Failed to remove days";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
