"use client";

import React from "react";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  maxHeight?: string;
  children: React.ReactNode;
}

export default function BottomSheet({ open, onClose, maxHeight = "75vh", children }: BottomSheetProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-30" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" />
      {/* Sheet */}
      <div
        className="absolute bottom-0 left-0 right-0 bg-surface-50 rounded-t-2xl shadow-2xl flex flex-col animate-sheetSlideUp"
        style={{ maxHeight }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="shrink-0 flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-surface-300" />
        </div>
        {/* Sheet content */}
        <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {children}
        </div>
      </div>
    </div>
  );
}
