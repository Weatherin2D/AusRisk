"use client";

import { useEffect, useMemo, useState } from "react";
import type { PublicForecastResponse, RolledDay } from "@/lib/forecast/types";
import { OutlookMapDynamic } from "@/components/forecast/outlook-map-dynamic";
import { RiskLegend } from "@/components/forecast/risk-legend";
import { cn } from "@/lib/utils";

export function PublicOutlook() {
  const [data, setData] = useState<PublicForecastResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/forecast", { cache: "no-store" });
        if (!res.ok) throw new Error("Could not load forecast");
        const json = (await res.json()) as PublicForecastResponse;
        if (cancelled) return;
        setData(json);
        setSelectedDay(json.defaultDay);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const active: RolledDay | null = useMemo(() => {
    if (!data?.days?.length) return null;
    return (
      data.days.find((d) => d.effectiveDay === selectedDay) ?? data.days[0]
    );
  }, [data, selectedDay]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#07141a] text-[#eef6f7]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(1200px 600px at 15% -10%, rgba(34, 140, 150, 0.28), transparent 60%), radial-gradient(900px 500px at 90% 10%, rgba(214, 154, 48, 0.12), transparent 55%), linear-gradient(180deg, #0a1c24 0%, #07141a 45%, #050f14 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "linear-gradient(180deg, black 0%, black 55%, transparent 100%)",
        }}
      />

      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-end justify-between gap-6 px-5 pb-4 pt-8 sm:px-8 sm:pt-10">
        <div className="animate-fade-up">
          <p className="font-[family-name:var(--font-display)] text-5xl leading-none tracking-tight text-[#f4fbfc] sm:text-7xl">
            AusRisk
          </p>
          <p className="mt-3 max-w-xl text-sm text-[#9eb8c0] sm:text-base">
            Public severe convective outlooks for Australia. Zoom and pan the
            map to explore risk areas.
          </p>
        </div>
        <a
          href="/admin"
          className="mb-1 hidden text-xs uppercase tracking-[0.2em] text-[#6f8b93] transition hover:text-[#d7ebea] sm:inline"
        >
          Admin
        </a>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-7xl px-5 pb-12 sm:px-8">
        {loading && (
          <div className="flex h-[62vh] items-center justify-center border border-[#1e3a44]/bg-[#0b1c24]/text-[#9db8c0]">
            Loading outlook…
          </div>
        )}

        {!loading && error && (
          <div className="flex h-[40vh] flex-col items-center justify-center gap-2 border border-[#5a2b2b] bg-[#1a0f10] text-center">
            <p className="font-[family-name:var(--font-display)] text-2xl text-[#ffb4b4]">
              Outlook unavailable
            </p>
            <p className="text-sm text-[#d7a0a0]">{error}</p>
          </div>
        )}

        {!loading && !error && data?.status === "empty" && (
          <div className="flex h-[50vh] flex-col items-center justify-center gap-3 border border-[#1e3a44] bg-[#0b1c24] text-center">
            <p className="font-[family-name:var(--font-display)] text-3xl text-[#e7f2f4]">
              No active outlook
            </p>
            <p className="max-w-md text-sm text-[#9db8c0]">
              {data.message ??
                "A forecast has not been issued, or previous day risks have rolled off."}
            </p>
          </div>
        )}

        {!loading && !error && data && data.status === "ok" && active && (
          <div className="animate-fade-up-delay grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
            <section className="min-w-0">
              <div className="mb-4 flex flex-wrap gap-2">
                {data.days.map((day) => {
                  const selected = day.effectiveDay === active.effectiveDay;
                  return (
                    <button
                      key={day.effectiveDay}
                      type="button"
                      onClick={() => setSelectedDay(day.effectiveDay)}
                      className={cn(
                        "border px-3 py-2 text-left transition",
                        selected
                          ? "border-[#3ec4c0] bg-[#123039] text-[#eef9f8]"
                          : "border-[#1e3a44] bg-[#0b1c24]/text-[#9db8c0] hover:border-[#2d5560] hover:text-[#d7ebea]",
                      )}
                    >
                      <span className="block text-sm font-semibold tracking-wide">
                        {day.label}
                      </span>
                      <span className="block text-xs opacity-80">
                        {day.dateLabel}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="h-[58vh] min-h-[360px] overflow-hidden border border-[#1e3a44] shadow-[0_20px_60px_rgba(0,0,0,0.35)] sm:h-[64vh]">
                <OutlookMapDynamic
                  mapView={data.mapView}
                  features={active.features}
                  legend={active.legend}
                />
              </div>

              <p className="mt-3 text-xs text-[#6f8b93]">
                {active.features.length
                  ? `${active.features.length} risk area${active.features.length === 1 ? "" : "s"} · ${active.source === "customLayers" ? "AusRisk layer" : "categorical fallback"}`
                  : "No polygons drawn for this day."}
                {data.issuedAt
                  ? ` · Issued ${new Date(data.issuedAt).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })} AEST/AEDT`
                  : null}
              </p>
            </section>

            <aside className="border border-[#1e3a44] bg-[#0b1c24]/p-4 lg:self-start">
              <h2 className="mb-3 font-[family-name:var(--font-display)] text-xl text-[#e7f2f4]">
                Key
              </h2>
              <RiskLegend items={active.legend} />
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
