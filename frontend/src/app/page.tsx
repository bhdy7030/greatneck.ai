"use client";

import { useRouter } from "next/navigation";
import VillageSelector from "@/components/VillageSelector";

export default function Home() {
  const router = useRouter();

  const handleVillageSelect = (village: string) => {
    setTimeout(() => {
      router.push("/chat/");
    }, 300);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6">
      <div className="text-center mb-10">
        <p className="text-sage text-sm font-medium tracking-wide uppercase mb-2">
          Long Island, New York
        </p>
        <h1 className="text-3xl md:text-4xl font-bold text-text-800 mb-3">
          Welcome to GreatNeck Assistant
        </h1>
        <p className="text-text-500 text-lg max-w-md mx-auto">
          Your neighborhood guide to village codes, permits, and local
          information.
        </p>
      </div>

      <div className="w-full max-w-2xl">
        <p className="text-sm text-text-500 text-center mb-4 uppercase tracking-wide font-semibold">
          Select your village to get started
        </p>
        <VillageSelector onSelect={handleVillageSelect} />
      </div>

      <p className="text-xs text-text-500 mt-12 text-center max-w-md">
        Information provided is for reference only. Always verify with official
        village resources for legal or permit-related matters.
      </p>
    </div>
  );
}
