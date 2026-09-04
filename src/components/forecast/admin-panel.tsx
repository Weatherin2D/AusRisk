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
  const [replaceAll, setReplaceAll] = useState(false);
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
      form.append("replaceAll", String(replaceAll));
      const res = await fetch("/api/admin/upload", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as {
        ok?: boolean;
        dayCount?: number;
        targetStartDay?: number;
        days?: number[];
        error?: string;
      };
      if (!res.ok) {
        setUploadError(json.error ?? "Upload failed");
        return;
      }
      const dayList = (json.days ?? []).join(", ");
      setUploadMessage(
        `Uploaded as Day ${json.targetStartDay ?? targetDay}. Active days: ${dayList || json.dayCount}. Days roll overnight (max ${MAX_FORECAST_DAYS}).`,
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
      <div className="flex min-h-screen items-center justify-center bg-[#07141a] text-[#9db8c0]">
        Checking session…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#07141a] px-5 py-10 text-[#eef6f7] sm:px-8">
      <div className="mx-auto max-w-xl">
        <a
          href="/"
          className="text-xs uppercase tracking-[0.2em] text-[#6f8b93] hover:text-[#d7ebea]"
        >
          ← AusRisk
        </a>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-4xl text-[#f4fbfc]">
          Admin
        </h1>
        <p className="mt-2 text-sm text-[#9db8c0]">
          Upload a GFC <code className="text-[#c9e6e3]">forecast-cycle</code>{" "}
          JSON. Only you can publish outlooks.
        </p>

        {!authenticated ? (
          <Card className="mt-8 border-[#1e3a44] bg-[#0b1c24] text-[#eef6f7]">
            <CardHeader>
              <CardTitle>Sign in</CardTitle>
              <CardDescription className="text-[#9db8c0]">
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
                    className="border-[#1e3a44] bg-[#07141a]"
                  />
                </div>
                {loginError && (
                  <p className="text-sm text-[#ffb4b4]">{loginError}</p>
                )}
                <Button type="submit" className="w-full">
                  Sign in
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-8 space-y-6">
            <Card className="border-[#1e3a44] bg-[#0b1c24] text-[#eef6f7]">
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>Manage days</CardTitle>
                  <CardDescription className="text-[#9db8c0]">
                    Remove a single day or wipe the whole public outlook.
                  </CardDescription>
                </div>
                <Button variant="outline" onClick={onLogout}>
                  Log out
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {storedDays.length === 0 ? (
                  <p className="text-sm text-[#9db8c0]">
                    No forecast days published.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {storedDays.map((day) => (
                      <li
                        key={day.day}
                        className="flex items-center justify-between gap-3 border border-[#1e3a44] bg-[#07141a] px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-semibold">Day {day.day}</p>
                          <p className="text-xs text-[#6f8b93]">
                            {formatValidDate(day.validDate)}
                            {day.hasCustomLayer ? " · AusRisk layer" : " · categorical"}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyDay !== null}
                          onClick={() => void removeDay(day.day)}
                          className="border-[#5a2b2b] text-[#ffb4b4] hover:bg-[#2a1515]"
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
                  className="w-full border-[#5a2b2b] text-[#ffb4b4] hover:bg-[#2a1515]"
                >
                  {busyDay === "all" ? "Wiping…" : "Wipe all forecast days"}
                </Button>
                {manageMessage && (
                  <p className="text-sm text-[#9fe0c5]">{manageMessage}</p>
                )}
                {manageError && (
                  <p className="text-sm text-[#ffb4b4]">{manageError}</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-[#1e3a44] bg-[#0b1c24] text-[#eef6f7]">
              <CardHeader>
                <CardTitle>Upload forecast</CardTitle>
                <CardDescription className="text-[#9db8c0]">
                  Choose which day slot (1–{MAX_FORECAST_DAYS}) this upload
                  should land on. Extra days in the file fill the following
                  slots. Maximum outlook range is {MAX_FORECAST_DAYS} days.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="targetDay">Publish starting as</Label>
                  <select
                    id="targetDay"
                    value={targetDay}
                    onChange={(e) => setTargetDay(Number(e.target.value))}
                    className="flex h-9 w-full rounded-md border border-[#1e3a44] bg-[#07141a] px-3 text-sm text-[#eef6f7] outline-none focus-visible:ring-2 focus-visible:ring-[#3ec4c0]"
                  >
                    {DAY_OPTIONS.map((day) => (
                      <option key={day} value={day}>
                        Day {day}
                        {day === 1 ? " (Today)" : ""}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-[#6f8b93]">
                    Example: pick Day 2 to place the first outlook in the file as
                    tomorrow. Later days in the file become Day 3, 4, …
                  </p>
                </div>

                <label className="flex items-start gap-3 text-sm text-[#c9e6e3]">
                  <input
                    type="checkbox"
                    checked={replaceAll}
                    onChange={(e) => setReplaceAll(e.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    Replace entire forecast cycle (otherwise merge into existing
                    days)
                  </span>
                </label>

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
                      ? "border-[#3ec4c0] bg-[#123039]"
                      : "border-[#2d5560] bg-[#07141a]"
                  }`}
                >
                  <span className="text-sm text-[#c9e6e3]">
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
                  <p className="text-sm text-[#9fe0c5]">{uploadMessage}</p>
                )}
                {uploadError && (
                  <p className="text-sm text-[#ffb4b4]">{uploadError}</p>
                )}
                <p className="text-xs text-[#6f8b93]">
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
