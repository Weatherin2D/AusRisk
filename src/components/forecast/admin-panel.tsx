"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MAX_FORECAST_DAYS } from "@/lib/forecast/process";

const DAY_OPTIONS = Array.from({ length: MAX_FORECAST_DAYS }, (_, i) => i + 1);

type StoredDay = {
  day: number;
  validDate: string | null;
  hasCustomLayer: boolean;
};

export function AdminPanel() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [targetDay, setTargetDay] = useState(1);
  const [publishMode, setPublishMode] = useState<"replace" | "single">(
    "replace",
  );
  const [storedDays, setStoredDays] = useState<StoredDay[]>([]);
  const [manageMessage, setManageMessage] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [busyDay, setBusyDay] = useState<number | "all" | null>(null);

  const refreshDays = useCallback(async () => {
    const res = await fetch("/api/admin/days", { cache: "no-store" });
    if (!res.ok) {
      setStoredDays([]);
      return;
    }
    const json = (await res.json()) as { days?: StoredDay[] };
    setStoredDays(json.days ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch("/api/admin/session", { cache: "no-store" });
        const json = (await res.json()) as { authenticated: boolean };
        if (!cancelled) {
          setAuthenticated(Boolean(json.authenticated));
          if (json.authenticated) await refreshDays();
        }
      } catch {
        if (!cancelled) setAuthenticated(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [refreshDays]);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setLoginError(null);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setLoginError("Incorrect password.");
      return;
    }
    setAuthenticated(true);
    setPassword("");
    await refreshDays();
  }

  async function onLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setAuthenticated(false);
    setStoredDays([]);
  }

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadError(null);
    setUploadMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("targetDay", String(targetDay));
      form.append("mode", publishMode);
      const res = await fetch("/api/admin/upload", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as {
        ok?: boolean;
        dayCount?: number;
        targetStartDay?: number;
        mode?: string;
        days?: number[];
        error?: string;
      };
      if (!res.ok) {
        setUploadError(json.error ?? "Upload failed");
        return;
      }
      const dayList = (json.days ?? []).join(", ");
      setUploadMessage(
        publishMode === "single"
          ? `Updated Day ${json.targetStartDay ?? targetDay} only. Active days: ${dayList || json.dayCount}.`
          : `Published from Day ${json.targetStartDay ?? targetDay}. Other existing days were kept. Active days: ${dayList || json.dayCount}.`,
      );
      await refreshDays();
    } catch {
      setUploadError("Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function removeDay(day: number) {
    if (!confirm(`Remove Day ${day} from the public outlook?`)) return;
    setBusyDay(day);
    setManageError(null);
    setManageMessage(null);
    try {
      const res = await fetch("/api/admin/days", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day }),
      });
      const json = (await res.json()) as { error?: string; days?: number[] };
      if (!res.ok) {
        setManageError(json.error ?? "Could not remove day");
        return;
      }
      setManageMessage(
        json.days?.length
          ? `Removed Day ${day}. Remaining: ${json.days.join(", ")}.`
          : `Removed Day ${day}. No active outlook days left.`,
      );
      await refreshDays();
    } catch {
      setManageError("Could not remove day");
    } finally {
      setBusyDay(null);
    }
  }

  async function wipeAll() {
    if (
      !confirm(
        "Wipe the entire forecast cycle? The public map will show no active outlook.",
      )
    ) {
      return;
    }
    setBusyDay("all");
    setManageError(null);
    setManageMessage(null);
    try {
      const res = await fetch("/api/admin/days?wipe=all", { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setManageError(json.error ?? "Could not wipe forecast");
        return;
      }
      setManageMessage("All forecast days wiped.");
      await refreshDays();
    } catch {
      setManageError("Could not wipe forecast");
    } finally {
      setBusyDay(null);
    }
  }

  function formatValidDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-AU", {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] text-neutral-400">
        Checking session…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] px-5 py-10 text-[#fafafa] sm:px-8">
      <div className="mx-auto max-w-xl">
        <a
          href="/"
          className="text-xs uppercase tracking-[0.22em] text-neutral-500 hover:text-white"
        >
          ← AusRisk
        </a>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight text-white">
          Admin
        </h1>
        <p className="mt-2 text-sm text-neutral-400">
          Upload a GFC <code className="text-neutral-200">forecast-cycle</code>{" "}
          JSON. Only you can publish outlooks.
        </p>

        {!authenticated ? (
          <Card className="mt-8 border-neutral-800 bg-neutral-950 text-[#fafafa]">
            <CardHeader>
              <CardTitle>Sign in</CardTitle>
              <CardDescription className="text-neutral-400">
                Enter the admin password to upload or manage forecasts.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="border-neutral-800 bg-black"
                  />
                </div>
                {loginError && (
                  <p className="text-sm text-red-400">{loginError}</p>
                )}
                <Button type="submit" className="w-full">
                  Sign in
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-8 space-y-6">
            <Card className="border-neutral-800 bg-neutral-950 text-[#fafafa]">
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>Manage days</CardTitle>
                  <CardDescription className="text-neutral-400">
                    Remove a single day or wipe the whole public outlook.
                  </CardDescription>
                </div>
                <Button variant="outline" onClick={onLogout}>
                  Log out
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {storedDays.length === 0 ? (
                  <p className="text-sm text-neutral-400">
                    No forecast days published.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {storedDays.map((day) => (
                      <li
                        key={day.day}
                        className="flex items-center justify-between gap-3 border border-neutral-800 bg-black px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-semibold">Day {day.day}</p>
                          <p className="text-xs text-neutral-500">
                            {formatValidDate(day.validDate)}
                            {day.hasCustomLayer
                              ? " · AusRisk layer"
                              : " · categorical"}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyDay !== null}
                          onClick={() => void removeDay(day.day)}
                          className="border-neutral-700 text-neutral-200 hover:bg-neutral-900"
                        >
                          {busyDay === day.day ? "Removing…" : "Remove"}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  variant="outline"
                  disabled={busyDay !== null || storedDays.length === 0}
                  onClick={() => void wipeAll()}
                  className="w-full border-neutral-700 text-neutral-200 hover:bg-neutral-900"
                >
                  {busyDay === "all" ? "Wiping…" : "Wipe all forecast days"}
                </Button>
                {manageMessage && (
                  <p className="text-sm text-neutral-300">{manageMessage}</p>
                )}
                {manageError && (
                  <p className="text-sm text-red-400">{manageError}</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-neutral-800 bg-neutral-950 text-[#fafafa]">
              <CardHeader>
                <CardTitle>Upload forecast</CardTitle>
                <CardDescription className="text-neutral-400">
                  Choose which day slot (1–{MAX_FORECAST_DAYS}) this upload
                  should land on. Extra days in the file fill the following
                  slots. Maximum outlook range is {MAX_FORECAST_DAYS} days.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="targetDay">Day slot</Label>
                  <select
                    id="targetDay"
                    value={targetDay}
                    onChange={(e) => setTargetDay(Number(e.target.value))}
                    className="flex h-9 w-full rounded-md border border-neutral-800 bg-black px-3 text-sm text-[#fafafa] outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    {DAY_OPTIONS.map((day) => (
                      <option key={day} value={day}>
                        Day {day}
                        {day === 1 ? " (Today)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <fieldset className="space-y-3 border border-neutral-800 p-3">
                  <legend className="px-1 text-sm font-medium text-neutral-200">
                    Publish mode
                  </legend>
                  <label className="flex items-start gap-3 text-sm text-neutral-300">
                    <input
                      type="radio"
                      name="publishMode"
                      checked={publishMode === "replace"}
                      onChange={() => setPublishMode("replace")}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium text-white">
                        Replace outlook
                      </span>
                      <span className="mt-0.5 block text-xs text-neutral-500">
                        Writes this file into the selected day slot (and the
                        following slots for multi-day files). Days you already
                        published outside those slots are kept. Use Wipe all
                        first for a clean slate.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3 text-sm text-neutral-300">
                    <input
                      type="radio"
                      name="publishMode"
                      checked={publishMode === "single"}
                      onChange={() => setPublishMode("single")}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium text-white">
                        Update one day only
                      </span>
                      <span className="mt-0.5 block text-xs text-neutral-500">
                        Puts only the AusRisk layer from the file into the
                        selected day slot and leaves every other day untouched.
                      </span>
                    </span>
                  </label>
                </fieldset>

                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) void uploadFile(file);
                  }}
                  className={`flex cursor-pointer flex-col items-center justify-center border border-dashed px-4 py-12 text-center transition ${
                    dragOver
                      ? "border-white bg-neutral-900"
                      : "border-neutral-700 bg-black"
                  }`}
                >
                  <span className="text-sm text-neutral-300">
                    {uploading
                      ? "Uploading…"
                      : "Drop JSON here or click to choose a file"}
                  </span>
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadFile(file);
                      e.target.value = "";
                    }}
                  />
                </label>
                {uploadMessage && (
                  <p className="text-sm text-neutral-300">{uploadMessage}</p>
                )}
                {uploadError && (
                  <p className="text-sm text-red-400">{uploadError}</p>
                )}
                <p className="text-xs text-neutral-500">
                  PLACEHOLDER legend entries are removed automatically on upload.
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
