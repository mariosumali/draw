import type { Metadata } from "next";

import { DailyGauntlet } from "@/components/game/DailyGauntlet";

export const metadata: Metadata = {
  title: "Daily Gauntlet",
  description: "Six daily AI drawing prompts, three lives, and one score to beat.",
};

export default function DailyPage() {
  return <DailyGauntlet />;
}
