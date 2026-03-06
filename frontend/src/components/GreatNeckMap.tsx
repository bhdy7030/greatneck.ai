"use client";

import { memo } from "react";
import { MAP_DATA } from "@/data/greatNeckMapData";

export default memo(function GreatNeckMap() {
  return (
    <div className="absolute inset-0 flex items-start justify-center overflow-hidden pointer-events-none">
      <svg
        viewBox="0 0 800 1000"
        className="w-full h-full"
        preserveAspectRatio="xMidYMin meet"
        aria-label="Map of Great Neck peninsula"
      >
        {/* Parks / green areas */}
        {MAP_DATA.parks.map((d, i) => (
          <path
            key={`park-${i}`}
            d={d}
            style={{
              fill: "rgb(var(--color-sage))",
              fillOpacity: 0.08,
              stroke: "rgb(var(--color-sage))",
              strokeWidth: 0.3,
              strokeOpacity: 0.2,
            }}
          />
        ))}

        {/* Water features */}
        {MAP_DATA.water.map((d, i) => (
          <path
            key={`water-${i}`}
            d={d}
            style={{
              fill: d.endsWith("Z") ? "rgb(var(--color-gold))" : "none",
              fillOpacity: 0.06,
              stroke: "rgb(var(--color-gold))",
              strokeWidth: 0.5,
              strokeOpacity: 0.15,
            }}
          />
        ))}

        {/* Buildings */}
        {MAP_DATA.buildings.map((d, i) => (
          <path
            key={`bld-${i}`}
            d={d}
            style={{
              fill: "rgb(var(--color-text-500))",
              fillOpacity: 0.06,
              stroke: "rgb(var(--color-text-500))",
              strokeWidth: 0.2,
              strokeOpacity: 0.12,
            }}
          />
        ))}

        {/* Coastline */}
        {MAP_DATA.coastline.map((d, i) => (
          <path
            key={`coast-${i}`}
            d={d}
            fill="none"
            style={{
              stroke: "rgb(var(--color-text-500))",
              strokeWidth: 1.4,
              strokeOpacity: 0.4,
              strokeLinejoin: "round",
            }}
          />
        ))}

        {/* Railways */}
        {MAP_DATA.railways.map((d, i) => (
          <path
            key={`rail-${i}`}
            d={d}
            fill="none"
            style={{
              stroke: "rgb(var(--color-text-500))",
              strokeWidth: 1,
              strokeOpacity: 0.2,
              strokeDasharray: "4 2",
            }}
          />
        ))}

        {/* Major streets */}
        {MAP_DATA.majorStreets.map((d, i) => (
          <path
            key={`major-${i}`}
            d={d}
            fill="none"
            strokeLinecap="round"
            style={{
              stroke: "rgb(var(--color-text-500))",
              strokeWidth: 1.2,
              strokeOpacity: 0.2,
            }}
          />
        ))}

        {/* Secondary streets */}
        {MAP_DATA.secondaryStreets.map((d, i) => (
          <path
            key={`sec-${i}`}
            d={d}
            fill="none"
            strokeLinecap="round"
            style={{
              stroke: "rgb(var(--color-text-500))",
              strokeWidth: 0.7,
              strokeOpacity: 0.18,
            }}
          />
        ))}

        {/* Residential streets */}
        {Object.values(MAP_DATA.villageStreets)
          .flat()
          .map((d, i) => (
            <path
              key={`res-${i}`}
              d={d}
              fill="none"
              strokeLinecap="round"
              style={{
                stroke: "rgb(var(--color-text-500))",
                strokeWidth: 0.4,
                strokeOpacity: 0.15,
              }}
            />
          ))}

        {/* Service roads */}
        {MAP_DATA.serviceRoads.map((d, i) => (
          <path
            key={`svc-${i}`}
            d={d}
            fill="none"
            strokeLinecap="round"
            style={{
              stroke: "rgb(var(--color-text-500))",
              strokeWidth: 0.3,
              strokeOpacity: 0.1,
            }}
          />
        ))}

        {/* Footpaths */}
        {MAP_DATA.footpaths.map((d, i) => (
          <path
            key={`fp-${i}`}
            d={d}
            fill="none"
            strokeLinecap="round"
            style={{
              stroke: "rgb(var(--color-text-500))",
              strokeWidth: 0.2,
              strokeOpacity: 0.08,
              strokeDasharray: "2 1",
            }}
          />
        ))}
      </svg>
    </div>
  );
});
