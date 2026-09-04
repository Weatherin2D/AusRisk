import { NextResponse } from "next/server";
import { rollForecast, DEFAULT_MAP_VIEW } from "@/lib/forecast/process";
import { noStoreHeaders, readStoredForecast } from "@/lib/forecast/storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET() {
  try {
    const forecast = await readStoredForecast();
    if (!forecast) {
      return NextResponse.json(
        {
          status: "empty",
          issuedAt: null,
          mapView: DEFAULT_MAP_VIEW,
          days: [],
          defaultDay: null,
          message:
            "No forecast uploaded yet. The AusRisk admin can publish an outlook from /admin.",
        },
        { headers: noStoreHeaders() },
      );
    }

    return NextResponse.json(rollForecast(forecast), {
      headers: noStoreHeaders(),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Failed to load forecast" },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}
