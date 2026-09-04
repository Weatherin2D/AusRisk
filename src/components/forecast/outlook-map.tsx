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

function HatchPatterns({ legend }: { legend: DisplayLegendItem[] }) {
  const map = useMap();
  const legendKey = legend.map((l) => `${l.id}:${l.style.hatch}`).join("|");

  useEffect(() => {
    const svg = map.getPanes().overlayPane.querySelector("svg");
    if (!svg) return;

    let defs = svg.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      svg.prepend(defs);
    }

    for (const item of legend) {
      const hatch = (item.style.hatch ?? "none").toLowerCase();
      if (hatch === "none") continue;
      const id = `hatch-${item.id}`;
      if (defs.querySelector(`#${CSS.escape(id)}`)) continue;

      const pattern = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "pattern",
      );
      pattern.setAttribute("id", id);
      pattern.setAttribute("patternUnits", "userSpaceOnUse");
      pattern.setAttribute("width", "8");
      pattern.setAttribute("height", "8");

      const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bg.setAttribute("width", "8");
      bg.setAttribute("height", "8");
      bg.setAttribute("fill", item.style.fillColor);
      bg.setAttribute("fill-opacity", String(item.style.fillOpacity));
      pattern.appendChild(bg);

      const stroke = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      stroke.setAttribute("stroke", "#111827");
      stroke.setAttribute("stroke-width", "1.2");
      stroke.setAttribute("stroke-opacity", "0.85");

      if (hatch === "diagonal") {
        stroke.setAttribute("d", "M0,8 L8,0");
      } else if (hatch === "crosshatch") {
        stroke.setAttribute("d", "M0,8 L8,0 M0,0 L8,8");
      } else {
        stroke.setAttribute("d", "M0,8 L8,0");
      }
      pattern.appendChild(stroke);
      defs.appendChild(pattern);
    }
  }, [legend, legendKey, map]);

  return null;
}

function pathStyle(feature: DisplayFeature): PathOptions {
  const hatch = (feature.style.hatch ?? "none").toLowerCase();
  if (hatch !== "none") {
    return {
      color: feature.style.strokeColor,
      weight: feature.style.strokeWidth,
      opacity: feature.style.strokeOpacity,
      fillColor: feature.style.fillColor,
      fillOpacity: feature.style.fillOpacity,
      fillRule: "evenodd",
      className: `ausrisk-hatch-${feature.categoryId}`,
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

export function OutlookMap({ mapView, features, legend }: OutlookMapProps) {
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
      return { color: "#111827", weight: 1, fillOpacity: 0.4 };
    }
    const hatch = (match.style.hatch ?? "none").toLowerCase();
    const base = pathStyle(match);
    if (hatch !== "none") {
      return {
        ...base,
        fillColor: match.style.fillColor,
        fillOpacity: match.style.fillOpacity,
      };
    }
    return base;
  };

  const onEachFeature = (feature: GeoJSON.Feature, layer: L.Layer) => {
    const title = String(feature.properties?.title ?? "");
    if (title) {
      layer.bindTooltip(title, { sticky: true });
    }

    const categoryId = String(feature.properties?.categoryId ?? "");
    const item = legend.find((l) => l.id === categoryId);
    const hatch = (item?.style.hatch ?? "none").toLowerCase();
    if (hatch !== "none" && layer instanceof L.Path) {
      const el = (layer as L.Path).getElement?.();
      if (el && el.tagName === "path") {
        el.setAttribute("fill", `url(#hatch-${categoryId})`);
      }
    }
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
      <HatchPatterns legend={legend} />
      <FitFeatures features={features} mapView={mapView} />
      <GeoJSON
        key={features.map((f) => f.id).join(",") || "empty"}
        data={geojson as GeoJSON.FeatureCollection}
        style={styleFn}
        onEachFeature={onEachFeature}
      />
    </MapContainer>
  );
}
