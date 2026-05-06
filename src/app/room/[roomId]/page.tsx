import { FocusedRoomClient } from "@/components/game/FocusedRoomClient";
import { RoomClient } from "@/components/game/RoomClient";

type RoomPageProps = {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ name?: string; view?: string }>;
};

export default async function RoomPage({ params, searchParams }: RoomPageProps) {
  const { roomId } = await params;
  const { name, view } = await searchParams;

  if (view === "focus") {
    return <FocusedRoomClient initialName={name} roomId={roomId} />;
  }

  return <RoomClient initialName={name} roomId={roomId} />;
}
