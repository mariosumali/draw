import { notFound } from "next/navigation";

import { ModelLabPreview } from "./preview";

export default function DevModelsPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <ModelLabPreview />;
}
