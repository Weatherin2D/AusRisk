"use client";

import type { DisplayLegendItem } from "@/lib/forecast/types";

type Props = {
  items: DisplayLegendItem[];
};

function swatchBackground(item: DisplayLegendItem): React.CSSProperties {
  const hatch = (item.style.hatch ?? "none").toLowerCase();
  const base: React.CSSProperties = {
    backgroundColor: item.style.fillColor,
    opacity: item.style.fillOpacity,
  };

  if (hatch === "diagonal") {
    return {
      ...base,
      backgroundImage:
        "repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(17,24,39,0.55) 3px, rgba(17,24,39,0.55) 5px)",
    };
  }

  if (hatch === "crosshatch") {
    return {
      ...base,
      backgroundImage:
        "repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(17,24,39,0.55) 3px, rgba(17,24,39,0.55) 5px), repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(17,24,39,0.45) 3px, rgba(17,24,39,0.45) 5px)",
    };
  }

  return base;
}

export function RiskLegend({ items }: Props) {
  if (!items.length) {
    return (
      <div className="text-sm text-[#9db8c0]">
        No risk categories in this outlook.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3">
          <span
            className="h-5 w-8 shrink-0 border border-black/80"
            style={swatchBackground(item)}
            aria-hidden="true"
          />
          <span className="text-sm font-semibold tracking-wide text-[#f2fbfb]">
            {item.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
