const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Parses simple "15m" / "30d" style durations (the subset @nestjs/jwt also accepts) into milliseconds. */
export function parseDurationMs(input: string): number {
  const match = /^(\d+)([smhd])$/.exec(input.trim());
  if (!match) throw new Error(`Unsupported duration format: ${input}`);
  return Number(match[1]) * UNIT_MS[match[2]];
}
