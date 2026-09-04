import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const samplePath = join(root, "public/samples/example-forecast.json");
const outPath = join(root, "data/current-forecast.json");

const forecast = JSON.parse(readFileSync(samplePath, "utf8"));

const now = new Date();
const sydney = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Sydney",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(now);
const [y, m, d] = sydney.split("-").map(Number);

function addDays(baseY, baseM, baseD, days) {
  const dt = new Date(Date.UTC(baseY, baseM - 1, baseD, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

for (const [key, day] of Object.entries(forecast.forecastCycle.days)) {
  const storedDay = day.day ?? Number(key);
  day.metadata = day.metadata || {};
  day.metadata.validDate = addDays(y, m, d, Math.max(0, storedDay - 1));
  day.metadata.issueDate = addDays(y, m, d, 0);
  if (day.customLayers?.layers) {
    for (const layer of day.customLayers.layers) {
      layer.categories = (layer.categories || []).filter(
        (c) => String(c.label).trim().toLowerCase() !== "placeholder",
      );
    }
  }
}

forecast.timestamp = new Date().toISOString();
forecast.forecastCycle.cycleDate = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(forecast, null, 2));
console.log("Seeded", outPath);
