import type { Metadata } from "next";

import { ModelHacker } from "@/components/game/ModelHacker";

export const metadata: Metadata = {
  title: "Model Hacker",
  description: "Steer the drawing AI through a decoy guess before landing the real target.",
};

export default function HackerPage() {
  return <ModelHacker />;
}
