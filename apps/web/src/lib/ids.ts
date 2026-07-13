export function randomId(prefix = ""): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return prefix ? `${prefix}-${id}` : id;
}

export function roomPath(roomId: string): string {
  return `/room/${encodeURIComponent(roomId)}`;
}
