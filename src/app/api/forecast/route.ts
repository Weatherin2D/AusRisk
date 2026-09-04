import { NextResponse } from "next/server";
import { rollForecast } from "@/lib/forecast/process";
import { readStoredForecast } from "@/lib/forecast/storage";
import { DEFAULT_MAP_VIEW } from "@/lib/forecast/process";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const forecast = await readStoredForecast();
    if (!forecast) {
      return NextResponse.json({
        status: "empty",
        issuedAt: null,
        mapView: DEFAULT_MAP_VIEW,
        days: [],
        defaultDay: null,
        message:
          "No forecast uploaded yet. The AusRisk admin can publish an outlook from /admin.",
      });
    }

    return NextResponse.json(rollForecast(forecast));
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Failed to load forecast" },
      { status: 500 },
    );
  }
}
