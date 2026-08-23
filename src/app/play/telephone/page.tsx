import type { Metadata } from "next";

import { TelephoneLab } from "@/components/game/TelephoneLab";

export const metadata: Metadata = {
  title: "AI Telephone",
  description: "Draw, let the AI reinterpret your sketch, then draw its guess in a four-link creative relay.",
};

export default function TelephonePage() {
  return <TelephoneLab />;
}
