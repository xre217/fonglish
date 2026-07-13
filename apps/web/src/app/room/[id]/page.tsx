import { Suspense } from "react";
import { RoomClient } from "./RoomClient";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const roomId = decodeURIComponent(id ?? "");

  if (!roomId) {
    return (
      <main className="container lobby">
        <p>Missing room id.</p>
      </main>
    );
  }

  return (
    <Suspense
      fallback={
        <main className="container lobby">
          <p className="muted">Loading room…</p>
        </main>
      }
    >
      <RoomClient roomId={roomId} />
    </Suspense>
  );
}
