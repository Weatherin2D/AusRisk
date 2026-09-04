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
        setSelectedDay((prev) => {
          if (
            prev != null &&
            json.days.some((d) => d.effectiveDay === prev)
          ) {
            return prev;
          }
          return json.defaultDay;
        });
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
    <div className="relative min-h-screen overflow-hidden bg-[#050505] text-[#fafafa]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(900px 480px at 10% -5%, rgba(255,255,255,0.06), transparent 55%), radial-gradient(700px 400px at 95% 0%, rgba(255,255,255,0.04), transparent 50%), linear-gradient(180deg, #0a0a0a 0%, #050505 50%, #000 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.9) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage:
            "linear-gradient(180deg, black 0%, black 40%, transparent 100%)",
        }}
      />

      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-end justify-between gap-6 px-5 pb-5 pt-8 sm:px-8 sm:pt-10">
        <div className="animate-fade-up">
          <p className="font-[family-name:var(--font-display)] text-5xl font-bold leading-none tracking-tight text-white sm:text-7xl">
            AusRisk
          </p>
          <p className="mt-3 max-w-xl text-sm text-neutral-400 sm:text-base">
            Public severe convective outlooks for Australia. Zoom and pan the
            map to explore risk areas.
          </p>
        </div>
        <a
          href="/admin"
          className="mb-1 hidden text-xs uppercase tracking-[0.22em] text-neutral-500 transition hover:text-white sm:inline"
        >
          Admin
        </a>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-7xl px-5 pb-12 sm:px-8">
        {loading && (
          <div className="flex h-[62vh] items-center justify-center border border-neutral-800 bg-neutral-950 text-neutral-400">
            Loading outlook…
          </div>
        )}

        {!loading && error && (
          <div className="flex h-[40vh] flex-col items-center justify-center gap-2 border border-neutral-700 bg-neutral-950 text-center">
            <p className="font-[family-name:var(--font-display)] text-2xl text-white">
              Outlook unavailable
            </p>
            <p className="text-sm text-neutral-400">{error}</p>
          </div>
        )}

        {!loading && !error && data?.status === "empty" && (
          <div className="flex h-[50vh] flex-col items-center justify-center gap-3 border border-neutral-800 bg-neutral-950 text-center">
            <p className="font-[family-name:var(--font-display)] text-3xl text-white">
              No active outlook
            </p>
            <p className="max-w-md text-sm text-neutral-400">
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
                          ? "border-white bg-white text-black"
                          : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-600 hover:text-white",
                      )}
                    >
                      <span className="block text-sm font-semibold tracking-wide">
                        {day.label}
                      </span>
                      <span className="block text-xs opacity-70">
                        {day.dateLabel}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="h-[58vh] min-h-[360px] overflow-hidden border border-neutral-800 sm:h-[64vh]">
                <OutlookMapDynamic
                  mapView={data.mapView}
                  features={active.features}
                  legend={active.legend}
                />
              </div>

              <p className="mt-3 text-xs text-neutral-500">
                {active.features.length
                  ? `${active.features.length} risk area${active.features.length === 1 ? "" : "s"} · ${active.source === "customLayers" ? "AusRisk layer" : "categorical fallback"}`
                  : "No polygons drawn for this day."}
                {data.issuedAt
                  ? ` · Issued ${new Date(data.issuedAt).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })} AEST/AEDT`
                  : null}
              </p>
            </section>

            <aside className="border border-neutral-800 bg-neutral-950 p-4 lg:self-start">
              <h2 className="mb-3 font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-white">
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
