"use client";

import type { DisplayLegendItem } from "@/lib/forecast/types";

type Props = {
  items: DisplayLegendItem[];
};

function hatchKind(item: DisplayLegendItem): "none" | "l1" | "l2" {
  const hatch = (item.style.hatch ?? "none").toLowerCase();
  const title = item.label.toLowerCase();
  if (title.includes("l2") || hatch === "crosshatch") return "l2";
  if (title.includes("l1") || hatch === "diagonal") return "l1";
  if (hatch !== "none") return "l1";
  return "none";
}

function swatchBackground(item: DisplayLegendItem): React.CSSProperties {
  const kind = hatchKind(item);
  const fill = item.style.fillColor;
  const opacity = item.style.fillOpacity;

  if (kind === "none") {
    return {
      backgroundColor: fill,
      opacity,
    };
  }

  // L1 thinner stripes, L2 thicker stripes
  const stripe =
    kind === "l2"
      ? "repeating-linear-gradient(135deg, #111 0 3px, transparent 3px 10px)"
      : "repeating-linear-gradient(135deg, #111 0 1.5px, transparent 1.5px 8px)";

  return {
    backgroundColor: fill,
    backgroundImage: stripe,
    opacity: 1,
    backgroundBlendMode: "normal",
  };
}

export function RiskLegend({ items }: Props) {
  if (!items.length) {
    return (
      <div className="text-sm text-neutral-500">
        No risk categories in this outlook.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3">
          <span
            className="h-5 w-8 shrink-0 border border-neutral-700"
            style={swatchBackground(item)}
            aria-hidden="true"
          />
          <span className="text-sm font-medium tracking-wide text-neutral-100">
            {item.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
