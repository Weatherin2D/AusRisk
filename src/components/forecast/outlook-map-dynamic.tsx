"use client";

import dynamic from "next/dynamic";
import type {
  DisplayFeature,
  DisplayLegendItem,
  MapView,
} from "@/lib/forecast/types";

const OutlookMap = dynamic(
  () =>
    import("@/components/forecast/outlook-map").then((mod) => mod.OutlookMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-neutral-200 text-sm text-neutral-600">
        Loading map…
      </div>
    ),
  },
);

type Props = {
  mapView: MapView;
  features: DisplayFeature[];
  legend: DisplayLegendItem[];
};

export function OutlookMapDynamic(props: Props) {
  return <OutlookMap {...props} />;
}
