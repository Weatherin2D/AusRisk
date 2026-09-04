# AusRisk

Public website for Australian severe convective outlooks. Upload a GFC `forecast-cycle` JSON from the admin page; the public homepage shows a zoomable dark map, day tabs, and the risk key (legend). `PLACEHOLDER` legend entries are removed automatically.

## Features

- Public outlook map with pan / scroll-wheel zoom on a dark basemap
- Day tabs that auto-roll in **Australia/Sydney** time (yesterday’s Day 2 becomes today’s Day 1)
- Outlook range capped at **5 days**
- Admin day picker: choose which day slot (1–5) an upload lands on, with optional merge
- Legend built from the AusRisk custom layer in your JSON
- Password-protected admin upload (`/admin`)

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://127.0.0.1:43127](http://127.0.0.1:43127).

Default admin password is set in `.env.local` as `ADMIN_PASSWORD` (use a long random secret). The example file only has a placeholder:

```
ADMIN_PASSWORD=change-me-to-a-long-random-secret
```

1. Go to `/admin` and sign in
2. Manage published days (remove one day or wipe all), or upload a new file
3. Pick the day slot (Day 1–5) the upload should start on
4. The public homepage updates immediately

An example file lives at `public/samples/example-forecast.json`.

## Day rolling

On upload, each stored day number is stamped to a Sydney calendar date (`today + day - 1`). On every public load, days with a past `validDate` drop off and remaining days are re-labelled (Day 2 → Day 1, and so on). Only Days 1–5 are kept.

## Stack

Next.js, TypeScript, Tailwind, shadcn/ui, Leaflet.
