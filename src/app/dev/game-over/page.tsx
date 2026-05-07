import { notFound } from "next/navigation";

import { GameOverPreview } from "./preview";

export default function GameOverPreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <GameOverPreview />;
}
