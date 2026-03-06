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
  onChangeRequest?: () => void;
}

export default function VillageSelector({ onSelect, onChangeRequest }: VillageSelectorProps) {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("gn_village");
    if (stored) {
      setSelected(stored);
    }
  }, []);

  const handleSelect = (villageName: string) => {
    if (selected && villageName !== selected && onChangeRequest) {
      onChangeRequest();
    }
    setSelected(villageName);
    localStorage.setItem("gn_village", villageName);
    onSelect(villageName);
  };

  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-2 max-w-3xl mx-auto">
      {VILLAGES.map((v) => (
        <button
          key={v.slug}
          onClick={() => handleSelect(v.name)}
          className={`relative p-3 rounded-xl border-2 transition-all duration-200 backdrop-blur-sm ${
            selected === v.name
              ? "border-sage bg-sage/10 shadow-lg shadow-sage/10"
              : "bg-surface-50/80 border-surface-300 hover:border-surface-400 hover:shadow-md"
          }`}
        >
          {selected === v.name && (
            <div className="absolute top-1.5 right-1.5">
              <svg
                className="w-4 h-4 text-sage"
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

          <h3
            className={`text-xs font-semibold text-center ${
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
