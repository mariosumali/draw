"use client";

import { useEffect, useRef, type ReactNode } from "react";
import rough from "roughjs";

type SketchyBorderProps = {
  children: ReactNode;
  color?: string;
  fill?: string;
  roughness?: number;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
};

export function SketchyBorder({
  children,
  color = "#1a1a1a",
  fill,
  roughness = 1.5,
  strokeWidth = 2.5,
  className = "",
  style,
}: SketchyBorderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const draw = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = rect.width;
      const h = rect.height;

      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      const rc = rough.canvas(canvas);
      const pad = strokeWidth;

      rc.rectangle(pad, pad, w - pad * 2, h - pad * 2, {
        stroke: color,
        strokeWidth,
        roughness,
        fill: fill || undefined,
        fillStyle: fill ? "solid" : undefined,
        bowing: 2,
      });
    };

    draw();

    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [color, fill, roughness, strokeWidth]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative", ...style }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
    </div>
  );
}
