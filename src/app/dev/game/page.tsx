import { notFound } from "next/navigation";

import { GamePagePreview } from "./preview";

export default function DevGamePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <GamePagePreview />;
}
