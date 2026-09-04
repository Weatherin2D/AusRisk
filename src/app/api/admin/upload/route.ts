import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import {
  isGfcForecast,
  normalizeForecastOnUpload,
} from "@/lib/forecast/process";
import { writeStoredForecast } from "@/lib/forecast/storage";

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const contentType = request.headers.get("content-type") ?? "";
    let parsed: unknown;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Missing file" }, { status: 400 });
      }
      const text = await file.text();
      parsed = JSON.parse(text);
    } else {
      parsed = await request.json();
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

    const normalized = normalizeForecastOnUpload(parsed);
    await writeStoredForecast(normalized);

    const dayCount = Object.keys(normalized.forecastCycle.days).length;
    return NextResponse.json({
      ok: true,
      dayCount,
      issuedAt: normalized.timestamp,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Upload failed. Check that the file is valid JSON." },
      { status: 400 },
    );
  }
}
