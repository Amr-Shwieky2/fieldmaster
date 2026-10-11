/** Wraps text in a left-to-right isolate (LRI ... PDI) so coordinates and codes keep their order inside an Arabic sentence. */
export function isolateLtr(text: string): string {
  return `⁦${text}⁩`;
}

/** `32.08530, 34.78180` (5 decimals, ~1 m), isolated for use inside Arabic text. */
export function formatCoordinates(latitude: number, longitude: number): string {
  return isolateLtr(`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
}

/** `10:30:45` in Asia/Jerusalem: the shared formatter's HH:mm plus seconds (the zone offset is whole minutes, so seconds are the same everywhere). */
export function timeWithSeconds(formatTime: (value: Date) => string, value: string | Date): string {
  const date = new Date(value);
  return `${formatTime(date)}:${String(date.getUTCSeconds()).padStart(2, "0")}`;
}
