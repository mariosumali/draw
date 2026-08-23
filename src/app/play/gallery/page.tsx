import type { Metadata } from "next";

import { CreativeGallery } from "@/components/game/CreativeGallery";

export const metadata: Metadata = {
  title: "Creative Gallery",
  description: "An untimed AI-assisted drawing sandbox with a personal local sketchbook.",
};

export default function GalleryPage() {
  return <CreativeGallery />;
}
