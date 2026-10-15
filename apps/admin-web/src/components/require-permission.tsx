"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Permission } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { useAccess } from "@/lib/use-access";
import { LoadingState } from "@/components/ui/states";

const asList = (permission: Permission | readonly Permission[]): readonly Permission[] => (typeof permission === "string" ? [permission] : permission);

/**
 * Client-side defense in depth for pages a member may open only with given
 * permissions (payroll, the audit log, users, roles, an onboarding review):
 * without every one of them the page is never rendered -- not merely hidden
 * -- and the member is sent to the dashboard. This is a UX guard, not a
 * security boundary: the API refuses these routes itself (PermissionsGuard)
 * whatever the browser renders.
 */
export function RequirePermission({ permission, children }: { permission: Permission | readonly Permission[]; children: ReactNode }) {
  const router = useRouter();
  const { session, loadAccess } = useAuth();
  const { ready, status, canAll } = useAccess();
  const allowed = ready && canAll(asList(permission));
  const denied = session != null && ready && !allowed;
  // Outside the signed-in shell nobody may have asked for /auth/me yet: a custom role cannot be decided without it.
  const mustLoad = session != null && !ready && status === "idle";

  useEffect(() => {
    if (mustLoad) void loadAccess?.();
  }, [mustLoad, loadAccess]);

  useEffect(() => {
    if (denied) router.replace("/dashboard");
  }, [denied, router]);

  if (!session || !allowed) return <LoadingState />;
  return <>{children}</>;
}

/** Renders its children only for a member who holds every permission of `permission` (or any of `anyOf`); otherwise `fallback`. */
export function Can({
  permission,
  anyOf,
  children,
  fallback = null,
}: {
  permission?: Permission | readonly Permission[];
  anyOf?: readonly Permission[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { canAll, canAny } = useAccess();
  const allowed = (permission === undefined || canAll(asList(permission))) && (anyOf === undefined || canAny(anyOf));
  return <>{allowed ? children : fallback}</>;
}
