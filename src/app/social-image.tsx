import { ImageResponse } from "next/og";

export const imageAlt = "Draw Battle! Quick Draw multiplayer social card.";
export const imageSize = {
  width: 1200,
  height: 630,
};

export function createDrawBattleShareImage() {
  const ruleLines = Array.from({ length: 12 }, (_, index) => (
    <div
      key={index}
      style={{
        position: "absolute",
        top: 75 + index * 48,
        left: 0,
        width: "100%",
        height: 3,
        background: "#c8d6e5",
        opacity: 0.75,
      }}
    />
  ));

  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          display: "flex",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          background: "#fdf6e3",
          color: "#1a1a1a",
          fontFamily: "Comic Sans MS, Marker Felt, Arial, sans-serif",
        }}
      >
        {ruleLines}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 100,
            width: 5,
            height: "100%",
            background: "#e88e8e",
          }}
        />
        {[129, 315, 501].map((top) => (
          <div
            key={top}
            style={{
              position: "absolute",
              top,
              left: 44,
              width: 28,
              height: 28,
              borderRadius: 999,
              background: "#d4c9a8",
            }}
          />
        ))}

        <div
          style={{
            position: "absolute",
            top: 78,
            left: 145,
            width: 910,
            height: 476,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "54px 62px",
            border: "12px solid #1a1a1a",
            borderRadius: 26,
            background: "#fff9ed",
            boxShadow: "14px 18px 0 rgba(0,0,0,0.12)",
            transform: "rotate(-1deg)",
          }}
        >
          <div
            style={{
              display: "flex",
              color: "#e53935",
              fontSize: 34,
              fontWeight: 800,
              letterSpacing: 4,
              textTransform: "uppercase",
            }}
          >
            Quick Draw multiplayer
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 24,
              fontSize: 138,
              fontWeight: 900,
              lineHeight: 0.9,
              letterSpacing: -8,
            }}
          >
            Draw Battle!
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            right: 120,
            top: 172,
            display: "flex",
            width: 86,
            height: 86,
            color: "#1a1a1a",
            fontSize: 86,
            lineHeight: 1,
            transform: "rotate(10deg)",
          }}
        >
          *
        </div>
        <div
          style={{
            position: "absolute",
            left: 195,
            bottom: 124,
            width: 450,
            height: 16,
            borderTop: "11px solid #f48fb1",
            borderRadius: "50%",
            transform: "rotate(-2deg)",
          }}
        />
      </div>
    ),
    imageSize,
  );
}
