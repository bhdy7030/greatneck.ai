"use client";

import { useState, useEffect } from "react";

const VILLAGES = [
  { name: "Great Neck", slug: "great_neck" },
  { name: "Great Neck Estates", slug: "great_neck_estates" },
  { name: "Great Neck Plaza", slug: "great_neck_plaza" },
  { name: "Kensington", slug: "kensington" },
  { name: "Kings Point", slug: "kings_point" },
  { name: "Thomaston", slug: "thomaston" },
];

interface VillageSelectorProps {
  onSelect: (village: string) => void;
}

export default function VillageSelector({ onSelect }: VillageSelectorProps) {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("greatneck_village");
    if (stored) {
      setSelected(stored);
    }
  }, []);

  const handleSelect = (villageName: string) => {
    setSelected(villageName);
    localStorage.setItem("greatneck_village", villageName);
    onSelect(villageName);
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-2xl mx-auto">
      {VILLAGES.map((v) => (
        <button
          key={v.slug}
          onClick={() => handleSelect(v.name)}
          className={`relative p-6 rounded-xl border-2 transition-all duration-200 ${
            selected === v.name
              ? "border-sage bg-sage/5 shadow-lg shadow-sage/10"
              : "bg-surface-50 border-surface-300 hover:border-surface-400 hover:shadow-md"
          }`}
        >
          {selected === v.name && (
            <div className="absolute top-2 right-2">
              <svg
                className="w-6 h-6 text-sage"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
          )}

          <div className="mb-3">
            <svg
              className={`w-8 h-8 mx-auto ${
                selected === v.name ? "text-sage" : "text-text-500"
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 9h.01M15 9h.01M9 13h.01M15 13h.01"
              />
            </svg>
          </div>

          <h3
            className={`text-sm font-semibold text-center ${
              selected === v.name ? "text-text-900" : "text-text-500"
            }`}
          >
            {v.name}
          </h3>
        </button>
      ))}
    </div>
  );
}
