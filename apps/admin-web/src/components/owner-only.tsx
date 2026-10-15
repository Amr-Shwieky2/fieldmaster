"use client";

import type { ReactNode } from "react";
import { Permission } from "@fieldmaster/shared-types";
import { RequirePermission } from "@/components/require-permission";

/**
 * Money-only content (Step 1's "Owner only"). Since the flexible
 * organization model it is whoever holds the financial permission -- an
 * Owner, or a custom role with the money group -- so this is
 * `RequirePermission` with `VIEW_FINANCIALS`, kept under its first name; a
 * page that needs a narrower permission (payroll, the dashboard) uses
 * `RequirePermission` with it. A UX guard, not a security boundary: the API
 * refuses the money routes itself.
 */
export function OwnerOnly({ children }: { children: ReactNode }) {
  return <RequirePermission permission={Permission.VIEW_FINANCIALS}>{children}</RequirePermission>;
}
