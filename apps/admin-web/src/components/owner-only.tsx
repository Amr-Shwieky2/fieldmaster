"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { OrgRole } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { LoadingState } from "@/components/ui/states";

/**
 * Client-side defense in depth for Owner-only pages (payroll, financial
 * dashboard). This is a UX guard, not a security boundary -- the API
 * itself rejects these routes for a Field Manager with 403 regardless of
 * what the browser renders (see PermissionsGuard + Permission.VIEW_PAYROLL).
 */
export function OwnerOnly({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { session } = useAuth();

  useEffect(() => {
    if (session && session.role !== OrgRole.OWNER) router.replace("/dashboard");
  }, [session, router]);

  if (!session || session.role !== OrgRole.OWNER) return <LoadingState />;
  return <>{children}</>;
}
