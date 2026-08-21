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
      <path d="M6 29 L27 8 L34 15 L13 36 L5 37 Z" />
      <path d="M24 11 L31 18" />
      <path d="M6 29 L13 36 L5 37 Z" />
      <path d="M29 6 L36 13 L34 15 L27 8 Z" />
      <path d="M5 37 L9 33" />
    </svg>
  ),
  trophy: (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 6 C12 16 14 23 20 23 C26 23 28 16 28 6 Z" />
      <path d="M12 9 H6 C6 16 9 19 14 19" />
      <path d="M28 9 H34 C34 16 31 19 26 19" />
      <path d="M20 23 V30 M14 35 C17 31 23 31 26 35 Z" />
      <path d="M15 6 C18 5 23 7 28 6" />
    </svg>
  ),
  bot: (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14 C9 10 12 8 16 8 H24 C28 8 31 10 31 14 V29 C31 32 28 34 24 34 H16 C12 34 9 32 9 29 Z" />
      <path d="M20 8 V4 M17 4 H23" />
      <circle cx="15" cy="20" r="2" />
      <circle cx="25" cy="20" r="2" />
      <path d="M15 27 C18 29 22 29 25 27 M5 18 V25 M35 18 V25" />
    </svg>
  ),
  lightning: (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 3 L8 23 H18 L15 37 L32 16 H21 Z" />
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
