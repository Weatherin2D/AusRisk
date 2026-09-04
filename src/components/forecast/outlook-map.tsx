"use client";

import { useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  useMap,
} from "react-leaflet";
import type { PathOptions } from "leaflet";
import L from "leaflet";
import type {
  CategoryStyle,
  DisplayFeature,
  DisplayLegendItem,
  MapView,
} from "@/lib/forecast/types";
import "leaflet/dist/leaflet.css";

type OutlookMapProps = {
  mapView: MapView;
  features: DisplayFeature[];
  legend: DisplayLegendItem[];
};

function hatchKind(style: CategoryStyle, label?: string): "none" | "l1" | "l2" {
  const hatch = (style.hatch ?? "none").toLowerCase();
  const title = (label ?? "").toLowerCase();
  if (title.includes("l2") || hatch === "crosshatch") return "l2";
  if (title.includes("l1") || hatch === "diagonal") return "l1";
  if (hatch !== "none") return "l1";
  return "none";
}

function patternIdFor(categoryId: string, kind: "l1" | "l2") {
  const safe = categoryId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `ausrisk-hatch-${kind}-${safe}`;
}

function ensureHatchPattern(
  svg: SVGElement,
  id: string,
  kind: "l1" | "l2",
  fillColor: string,
  fillOpacity: number,
) {
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.insertBefore(defs, svg.firstChild);
  }

  const existing = defs.querySelector(`#${CSS.escape(id)}`);
  if (existing) existing.remove();

  // L1: regular diagonal stripes. L2: same direction, thicker strokes.
  const size = kind === "l2" ? 14 : 10;
  const strokeWidth = kind === "l2" ? 3.25 : 1.5;

  const pattern = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "pattern",
  );
  pattern.setAttribute("id", id);
  pattern.setAttribute("patternUnits", "userSpaceOnUse");
  pattern.setAttribute("width", String(size));
  pattern.setAttribute("height", String(size));
  pattern.setAttribute("patternTransform", "rotate(0)");

  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", String(size));
  bg.setAttribute("height", String(size));
  bg.setAttribute("fill", fillColor || "#898989");
  bg.setAttribute(
    "fill-opacity",
    String(fillOpacity > 0 ? Math.min(fillOpacity, 0.35) : 0.12),
  );
  pattern.appendChild(bg);

  const stripe = document.createElementNS("http://www.w3.org/2000/svg", "path");
  // Full diagonal across the tile so stripes tile cleanly
  stripe.setAttribute("d", `M0,${size} L${size},0`);
  stripe.setAttribute("stroke", "#111111");
  stripe.setAttribute("stroke-width", String(strokeWidth));
  stripe.setAttribute("stroke-opacity", kind === "l2" ? "0.95" : "0.85");
  stripe.setAttribute("stroke-linecap", "square");
  pattern.appendChild(stripe);

  // Extra parallel line so denser coverage within each tile
  const stripe2 = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  stripe2.setAttribute("d", `M${-size / 2},${size} L${size / 2},0`);
  stripe2.setAttribute("stroke", "#111111");
  stripe2.setAttribute("stroke-width", String(strokeWidth));
  stripe2.setAttribute("stroke-opacity", kind === "l2" ? "0.95" : "0.85");
  stripe2.setAttribute("stroke-linecap", "square");
  pattern.appendChild(stripe2);

  const stripe3 = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  stripe3.setAttribute("d", `M${size / 2},${size} L${size + size / 2},0`);
  stripe3.setAttribute("stroke", "#111111");
  stripe3.setAttribute("stroke-width", String(strokeWidth));
  stripe3.setAttribute("stroke-opacity", kind === "l2" ? "0.95" : "0.85");
  stripe3.setAttribute("stroke-linecap", "square");
  pattern.appendChild(stripe3);

  defs.appendChild(pattern);
}

function applyPatternFill(layer: L.Path, patternId: string) {
  const el = layer.getElement();
  if (!el || el.tagName.toLowerCase() !== "path") return false;
  const svg = (el as SVGElement).ownerSVGElement;
  if (!svg) return false;
  el.setAttribute("fill", `url(#${patternId})`);
  el.setAttribute("fill-opacity", "1");
  return true;
}

function FitFeatures({
  features,
  mapView,
}: {
  features: DisplayFeature[];
  mapView: MapView;
}) {
  const map = useMap();

  useEffect(() => {
    if (!features.length) {
      map.setView(mapView.center, mapView.zoom, { animate: false });
      return;
    }
    const layer = L.geoJSON(
      {
        type: "FeatureCollection",
        features: features.map((f) => ({
          type: "Feature" as const,
          geometry: f.geometry,
          properties: {},
        })),
      } as GeoJSON.FeatureCollection,
    );
    const bounds = layer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.15), { animate: false, maxZoom: 8 });
    } else {
      map.setView(mapView.center, mapView.zoom, { animate: false });
    }
  }, [features, map, mapView.center, mapView.zoom]);

  return null;
}

function pathStyle(feature: DisplayFeature): PathOptions {
  const kind = hatchKind(feature.style, feature.title);
  if (kind !== "none") {
    return {
      color: feature.style.strokeColor || "#111111",
      weight: feature.style.strokeWidth ?? 2,
      opacity: feature.style.strokeOpacity ?? 1,
      // Temporary solid fill until pattern is applied on add
      fillColor: feature.style.fillColor || "#898989",
      fillOpacity: 0.15,
      className: `ausrisk-hatch ausrisk-hatch-${kind}`,
    };
  }

  return {
    color: feature.style.strokeColor,
    weight: feature.style.strokeWidth,
    opacity: feature.style.strokeOpacity,
    fillColor: feature.style.fillColor,
    fillOpacity: feature.style.fillOpacity,
  };
}

export function OutlookMap({ mapView, features, legend: _legend }: OutlookMapProps) {
  const geojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: features.map((f) => ({
        type: "Feature" as const,
        id: f.id,
        geometry: f.geometry,
        properties: {
          title: f.title,
          categoryId: f.categoryId,
          style: f.style,
        },
      })),
    }),
    [features],
  );

  const styleFn = (feature?: GeoJSON.Feature) => {
    const match = features.find((f) => f.id === feature?.id);
    if (!match) {
      return { color: "#111111", weight: 1, fillOpacity: 0.4 };
    }
    return pathStyle(match);
  };

  const onEachFeature = (feature: GeoJSON.Feature, layer: L.Layer) => {
    const title = String(feature.properties?.title ?? "");
    if (title) {
      layer.bindTooltip(title, { sticky: true });
    }

    const match = features.find((f) => f.id === feature.id);
    if (!match || !(layer instanceof L.Path)) return;

    const kind = hatchKind(match.style, match.title);
    if (kind === "none") return;

    const id = patternIdFor(match.categoryId, kind);

    const paint = () => {
      const el = layer.getElement();
      if (!el) return;
      const svg = (el as SVGElement).ownerSVGElement;
      if (!svg) return;
      ensureHatchPattern(
        svg,
        id,
        kind,
        match.style.fillColor || "#898989",
        match.style.fillOpacity ?? 0.15,
      );
      applyPatternFill(layer, id);
    };

    layer.on("add", () => {
      paint();
      requestAnimationFrame(paint);
      setTimeout(paint, 0);
      setTimeout(paint, 50);
    });

    // If already on map
    paint();
    requestAnimationFrame(paint);
  };

  return (
    <MapContainer
      center={mapView.center}
      zoom={mapView.zoom}
      className="h-full w-full rounded-none"
      scrollWheelZoom
      zoomControl
      attributionControl={false}
    >
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        attribution="Tiles &copy; Esri"
        maxZoom={16}
      />
      <FitFeatures features={features} mapView={mapView} />
      <GeoJSON
        key={features.map((f) => `${f.id}:${f.style.hatch}`).join(",") || "empty"}
        data={geojson as GeoJSON.FeatureCollection}
        style={styleFn}
        onEachFeature={onEachFeature}
      />
    </MapContainer>
  );
}
