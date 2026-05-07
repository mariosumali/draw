import { createDrawBattleShareImage, imageAlt, imageSize } from "./social-image";

export const alt = imageAlt;
export const contentType = "image/png";
export const size = imageSize;

export default function TwitterImage() {
  return createDrawBattleShareImage();
}
