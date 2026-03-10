"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { useLanguage } from "./LanguageProvider";

interface ImageAnnotatorProps {
  imageDataUrl: string; // full data-URL from FileReader
  onDone: (mergedBase64: string, mime: string) => void;
  onSkip: () => void;
}

export default function ImageAnnotator({ imageDataUrl, onDone, onSkip }: ImageAnnotatorProps) {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  // Canvas display dimensions (fit image to screen)
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0, offsetX: 0, offsetY: 0 });

  // Resize canvas to fit image within container
  const fitCanvas = useCallback(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!img || !container || !canvas || !img.naturalWidth) return;

    const maxW = container.clientWidth;
    const maxH = container.clientHeight;
    const imgAspect = img.naturalWidth / img.naturalHeight;
    let w: number, h: number;

    if (imgAspect > maxW / maxH) {
      w = maxW;
      h = maxW / imgAspect;
    } else {
      h = maxH;
      w = maxH * imgAspect;
    }

    const offsetX = (maxW - w) / 2;
    const offsetY = (maxH - h) / 2;

    canvas.width = w;
    canvas.height = h;
    canvas.style.left = `${offsetX}px`;
    canvas.style.top = `${offsetY}px`;

    setDisplaySize({ w, h, offsetX, offsetY });
  }, []);

  useEffect(() => {
    if (imgLoaded) fitCanvas();
  }, [imgLoaded, fitCanvas]);

  useEffect(() => {
    window.addEventListener("resize", fitCanvas);
    return () => window.removeEventListener("resize", fitCanvas);
  }, [fitCanvas]);

  // Drawing handlers
  const getPos = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    setIsDrawing(true);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e);
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasDrawn(true);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    e.preventDefault();
    setIsDrawing(false);
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const handleDone = () => {
    const img = imgRef.current;
    const annotationCanvas = canvasRef.current;
    if (!img || !annotationCanvas) return;

    // Merge image + annotations onto a temp canvas at original resolution
    const mergeCanvas = document.createElement("canvas");
    mergeCanvas.width = img.naturalWidth;
    mergeCanvas.height = img.naturalHeight;
    const ctx = mergeCanvas.getContext("2d");
    if (!ctx) return;

    // Draw original image
    ctx.drawImage(img, 0, 0);

    // Scale up annotation overlay to original image resolution
    if (hasDrawn) {
      const scaleX = img.naturalWidth / annotationCanvas.width;
      const scaleY = img.naturalHeight / annotationCanvas.height;
      ctx.save();
      ctx.scale(scaleX, scaleY);
      ctx.drawImage(annotationCanvas, 0, 0);
      ctx.restore();
    }

    const dataUrl = mergeCanvas.toDataURL("image/jpeg", 0.85);
    const base64 = dataUrl.split(",")[1];
    onDone(base64, "image/jpeg");
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 flex items-center justify-between bg-black/80">
        <h2 className="text-white text-sm font-medium">{t("annotate.title")}</h2>
        <button
          onClick={onSkip}
          className="text-white/70 text-sm hover:text-white transition-colors"
        >
          {t("annotate.skip")}
        </button>
      </div>

      {/* Image + canvas area */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        {/* Hidden image for natural dimensions */}
        <img
          ref={imgRef}
          src={imageDataUrl}
          alt=""
          onLoad={() => setImgLoaded(true)}
          className="absolute"
          style={{
            left: `${displaySize.offsetX}px`,
            top: `${displaySize.offsetY}px`,
            width: `${displaySize.w}px`,
            height: `${displaySize.h}px`,
            objectFit: "contain",
          }}
        />
        {/* Canvas overlay */}
        <canvas
          ref={canvasRef}
          className="absolute touch-none"
          style={{ cursor: "crosshair" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>

      {/* Bottom bar */}
      <div className="flex-shrink-0 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex gap-3 justify-center bg-black/80">
        <button
          onClick={handleClear}
          disabled={!hasDrawn}
          className="px-6 py-2.5 rounded-xl text-sm font-medium bg-surface-700 text-white disabled:opacity-40 transition-colors hover:bg-surface-600"
        >
          {t("annotate.clear")}
        </button>
        <button
          onClick={handleDone}
          className="px-6 py-2.5 rounded-xl text-sm font-medium bg-sage text-white transition-colors hover:bg-sage-dark"
        >
          {t("annotate.done")}
        </button>
      </div>
    </div>
  );
}
