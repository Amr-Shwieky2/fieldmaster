import { NotificationType, OrgRole } from "@fieldmaster/shared-types";
import {
  MANAGER_NOTIFICATION_TYPES,
  WORKER_NOTIFICATION_TYPES,
  isPushEnabled,
  readPushPreferences,
  receivableNotificationTypes,
  withPushPreferences,
} from "../notification-preferences";

describe("notification preferences (Step 9: push per type, in-app always)", () => {
  it("lists what each role receives: workers their own records, managers the manager-facing types, both for a time-trackable manager", () => {
    expect(receivableNotificationTypes(OrgRole.WORKER, true)).toEqual([
      NotificationType.SHIFT_APPROVED,
      NotificationType.SHIFT_REJECTED,
      NotificationType.WORKER_APPROVED,
      NotificationType.TURAN_ASSIGNMENT_CREATED,
      NotificationType.TURAN_ASSIGNMENT_CHANGED,
    ]);
    const manager = receivableNotificationTypes(OrgRole.FIELD_MANAGER, false);
    expect(manager.sort()).toEqual([...MANAGER_NOTIFICATION_TYPES].sort());
    expect(manager).not.toContain(NotificationType.SHIFT_APPROVED);
    expect(receivableNotificationTypes(OrgRole.OWNER, false).sort()).toEqual([...MANAGER_NOTIFICATION_TYPES].sort());
    expect(receivableNotificationTypes(OrgRole.FIELD_MANAGER, true).sort()).toEqual([...MANAGER_NOTIFICATION_TYPES, ...WORKER_NOTIFICATION_TYPES].sort());
    // Never a type the API does not send.
    for (const role of Object.values(OrgRole)) expect(receivableNotificationTypes(role, true)).not.toContain(NotificationType.PAYROLL_FINALIZED);
  });

  it("push is on unless switched off; malformed stored entries count as unset", () => {
    expect(isPushEnabled({}, NotificationType.SHIFT_APPROVED)).toBe(true);
    expect(isPushEnabled(null, NotificationType.SHIFT_APPROVED)).toBe(true);
    expect(isPushEnabled({ SHIFT_APPROVED: { push: false } }, NotificationType.SHIFT_APPROVED)).toBe(false);
    expect(isPushEnabled({ SHIFT_APPROVED: { push: false } }, NotificationType.SHIFT_REJECTED)).toBe(true);
    expect(readPushPreferences({ A: { push: "no" }, B: true, C: { push: true }, D: null } as never)).toEqual({ C: true });
    expect(readPushPreferences([] as never)).toEqual({});
  });

  it("applies changes and keeps the other switches", () => {
    expect(withPushPreferences({ SHIFT_APPROVED: { push: false }, TURAN_ASSIGNMENT_CREATED: { push: false } }, [{ type: "TURAN_ASSIGNMENT_CREATED", push: true }])).toEqual({
      SHIFT_APPROVED: { push: false },
      TURAN_ASSIGNMENT_CREATED: { push: true },
    });
  });
});
