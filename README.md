# AusRisk

Public website for Australian severe convective outlooks. Upload a GFC `forecast-cycle` JSON from the admin page; the public homepage shows a zoomable map, day tabs, and the risk key (legend). `PLACEHOLDER` legend entries are removed automatically.

## Features

- Public outlook map with pan / scroll-wheel zoom
- Day tabs that auto-roll in **Australia/Sydney** time (yesterday’s Day 2 becomes today’s Day 1)
- Legend built from the AusRisk custom layer in your JSON
- Password-protected admin upload (`/admin`)

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://127.0.0.1:43127](http://127.0.0.1:43127).

Default admin password (override in `.env.local`):

```
ADMIN_PASSWORD=ausrisk-admin
```

1. Go to `/admin` and sign in
2. Upload a `gfc-forecast-*.json` file
3. The public homepage updates immediately

An example file lives at `public/samples/example-forecast.json`.

## Day rolling

On upload, each stored day number is stamped to a Sydney calendar date (`today + day - 1`). On every public load, days with a past `validDate` drop off and remaining days are re-labelled (Day 2 → Day 1, and so on).

## Stack

Next.js, TypeScript, Tailwind, shadcn/ui, Leaflet.
