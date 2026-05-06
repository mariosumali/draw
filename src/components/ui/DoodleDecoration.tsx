"use client";

const DOODLES = {
  star: (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 4 L23 15 L34 15 L25 22 L28 33 L20 26 L12 33 L15 22 L6 15 L17 15 Z" />
    </svg>
  ),
  arrow: (
    <svg viewBox="0 0 50 30" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 15 C12 14, 28 13, 40 15" />
      <path d="M34 8 L42 15 L34 22" />
    </svg>
  ),
  squiggle: (
    <svg viewBox="0 0 60 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M3 10 C10 3, 15 17, 22 10 C29 3, 34 17, 41 10 C48 3, 53 17, 58 10" />
    </svg>
  ),
  circle: (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M20 4 C30 3, 38 10, 37 20 C36 30, 28 37, 18 36 C8 35, 2 28, 3 18 C4 8, 12 3, 20 4" />
    </svg>
  ),
  checkmark: (
    <svg viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 16 L12 23 L26 7" />
    </svg>
  ),
  underline: (
    <svg viewBox="0 0 80 12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <path d="M3 8 C20 4, 40 10, 60 5 C70 3, 75 7, 78 6" />
    </svg>
  ),
  pencil: (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 32 L28 12 L32 8 L36 4 L32 8 L28 12 L8 32 L4 36 L8 32" />
      <path d="M4 36 L8 32" />
      <path d="M28 12 L32 16" />
    </svg>
  ),
};

type DoodleType = keyof typeof DOODLES;

type DoodleDecorationProps = {
  type: DoodleType;
  size?: number;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
  rotate?: number;
};

export function DoodleDecoration({
  type,
  size = 24,
  color = "#1a1a1a",
  className = "",
  style,
  rotate = 0,
}: DoodleDecorationProps) {
  return (
    <span
      className={className}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        color,
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
        flexShrink: 0,
        ...style,
      }}
      aria-hidden="true"
    >
      {DOODLES[type]}
    </span>
  );
}
