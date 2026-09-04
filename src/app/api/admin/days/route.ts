import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { MAX_FORECAST_DAYS } from "@/lib/forecast/process";
import {
  clearStoredForecast,
  noStoreHeaders,
  readStoredForecast,
  removeForecastDays,
} from "@/lib/forecast/storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: noStoreHeaders() },
    );
  }

  const forecast = await readStoredForecast();
  if (!forecast) {
    return NextResponse.json(
      { days: [], issuedAt: null },
      { headers: noStoreHeaders() },
    );
  }

  const days = Object.values(forecast.forecastCycle.days)
    .map((day) => ({
      day: day.day,
      validDate: day.metadata?.validDate ?? null,
      hasCustomLayer: Boolean(day.customLayers?.layers?.length),
    }))
    .sort((a, b) => a.day - b.day);

  return NextResponse.json(
    {
      days,
      issuedAt: forecast.timestamp ?? null,
      maxDays: MAX_FORECAST_DAYS,
    },
    { headers: noStoreHeaders() },
  );
}

export async function DELETE(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: noStoreHeaders() },
    );
  }

  try {
    const url = new URL(request.url);
    const wipe = url.searchParams.get("wipe") === "all";
    let dayNumbers: number[] = [];

    if (wipe) {
      await clearStoredForecast();
      return NextResponse.json(
        { ok: true, wiped: true, days: [] },
        { headers: noStoreHeaders() },
      );
    }

    const body = await request.json().catch(() => ({}));
    if (Array.isArray(body.days)) {
      dayNumbers = body.days
        .map((n: unknown) => Number(n))
        .filter(Number.isFinite);
    } else if (body.day != null) {
      dayNumbers = [Number(body.day)].filter(Number.isFinite);
    } else if (url.searchParams.has("day")) {
      dayNumbers = [Number(url.searchParams.get("day"))].filter(
        Number.isFinite,
      );
    }

    if (!dayNumbers.length) {
      return NextResponse.json(
        { error: "Specify day, days[], or wipe=all" },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    const next = await removeForecastDays(dayNumbers);
    const remaining = next
      ? Object.values(next.forecastCycle.days)
          .map((d) => d.day)
          .sort((a, b) => a - b)
      : [];

    return NextResponse.json(
      {
        ok: true,
        removed: dayNumbers,
        days: remaining,
        wiped: remaining.length === 0,
      },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error ? error.message : "Failed to remove days";
    return NextResponse.json(
      { error: message },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}
