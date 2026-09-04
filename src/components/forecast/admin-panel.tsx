"use client";

import { useEffect, useState, type FormEvent } from "react";
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

export function AdminPanel() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch("/api/admin/session", { cache: "no-store" });
        const json = (await res.json()) as { authenticated: boolean };
        if (!cancelled) setAuthenticated(Boolean(json.authenticated));
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
  }, []);

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
  }

  async function onLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setAuthenticated(false);
  }

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadError(null);
    setUploadMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/upload", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as {
        ok?: boolean;
        dayCount?: number;
        error?: string;
      };
      if (!res.ok) {
        setUploadError(json.error ?? "Upload failed");
        return;
      }
      setUploadMessage(
        `Uploaded successfully. ${json.dayCount ?? 0} day(s) published. Day numbers will roll automatically overnight.`,
      );
    } catch {
      setUploadError("Upload failed.");
    } finally {
      setUploading(false);
    }
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
                Enter the admin password to upload forecasts.
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
          <Card className="mt-8 border-[#1e3a44] bg-[#0b1c24] text-[#eef6f7]">
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Upload forecast</CardTitle>
                <CardDescription className="text-[#9db8c0]">
                  Drop a <code>gfc-forecast-*.json</code> file. Valid dates are
                  set from the day numbers relative to today (Sydney), so Day 2
                  becomes Day 1 tomorrow.
                </CardDescription>
              </div>
              <Button variant="outline" onClick={onLogout}>
                Log out
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
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
        )}
      </div>
    </div>
  );
}
