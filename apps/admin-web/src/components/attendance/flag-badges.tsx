"use client";

import { AttendanceFlag } from "@fieldmaster/shared-types";
import { useEnumLabel } from "@/i18n/enums";
import { Badge } from "@/components/ui/badge";

const FLAG_TONES: Record<AttendanceFlag, "danger" | "warning" | "info"> = {
  [AttendanceFlag.OUTSIDE_GEOFENCE_ATTEMPT]: "danger",
  [AttendanceFlag.SUSPICIOUS_LOCATION]: "danger",
  [AttendanceFlag.OFFLINE]: "info",
  [AttendanceFlag.FLEXI_CHECK]: "info",
  [AttendanceFlag.TEMPORARY_POINT]: "info",
  [AttendanceFlag.EMERGENCY]: "warning",
  [AttendanceFlag.DEV_REWOUND]: "warning",
};

/** A time entry's flags as Arabic badges (from the shared `AttendanceFlag` labels). */
export function FlagBadges({ flags }: { flags: AttendanceFlag[] }) {
  const label = useEnumLabel();
  if (flags.length === 0) return null;
  return (
    <>
      {flags.map((flag) => (
        <Badge key={flag} tone={FLAG_TONES[flag] ?? "neutral"}>
          {label("AttendanceFlag", flag)}
        </Badge>
      ))}
    </>
  );
}
