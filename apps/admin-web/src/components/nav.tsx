"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Permission } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { useAccess, useRoleLabel, type Access } from "@/lib/use-access";
import { ADMIN_WEB_PERMISSIONS } from "@/lib/permissions";
import { cn } from "@/lib/cn";
import { useDevLoginUsers } from "@/components/dev-quick-login";
import { Badge } from "@/components/ui/badge";

type NavKey =
  | "dashboard"
  | "operations"
  | "workers"
  | "invitations"
  | "sitesProjects"
  | "scheduling"
  | "turanEmergency"
  | "attendanceApproval"
  | "forgottenStamps"
  | "emergencies"
  | "payroll"
  | "reports"
  | "notifications"
  | "auditLog"
  | "settings"
  | "users"
  | "roles"
  | "workerSimulator";

/**
 * Each entry is shown to a member who holds every permission of `all` (and
 * at least one of `any`), whatever their role is called. `devOnly` items
 * exist only while the API is in dev login (test) mode; with it off they are
 * not rendered at all.
 */
const NAV_ITEMS: { href: string; key: NavKey; all?: readonly Permission[]; any?: readonly Permission[]; devOnly?: boolean }[] = [
  // The admin web's own pages: anyone with a permission beyond a worker's own clock-in and attendance.
  { href: "/dashboard", key: "dashboard", any: ADMIN_WEB_PERMISSIONS },
  { href: "/operations", key: "operations", all: [Permission.VIEW_OPERATIONS] },
  { href: "/workers", key: "workers", all: [Permission.MANAGE_WORKERS] },
  // Step 8: single-use join links (reviewing an application also needs the bank details).
  { href: "/workers/invitations", key: "invitations", all: [Permission.APPROVE_ONBOARDING] },
  { href: "/sites", key: "sitesProjects", all: [Permission.MANAGE_SITES] },
  { href: "/shifts", key: "scheduling", all: [Permission.VIEW_SHIFTS] },
  { href: "/turan", key: "turanEmergency", all: [Permission.MANAGE_TURAN] },
  { href: "/attendance", key: "attendanceApproval", all: [Permission.VIEW_ATTENDANCE] },
  { href: "/attendance/forgotten-stamps", key: "forgottenStamps", all: [Permission.VIEW_ATTENDANCE] },
  { href: "/emergencies", key: "emergencies", all: [Permission.VIEW_ATTENDANCE] },
  // Payroll is money: only with VIEW_PAYROLL (which needs VIEW_FINANCIALS) -- never a Field Manager's (spec 6.2 / 23.5).
  { href: "/payroll", key: "payroll", all: [Permission.VIEW_FINANCIALS, Permission.VIEW_PAYROLL] },
  { href: "/reports", key: "reports", any: [Permission.GENERATE_OPERATIONAL_REPORTS, Permission.GENERATE_FINANCIAL_REPORTS] },
  { href: "/notifications", key: "notifications", any: ADMIN_WEB_PERMISSIONS },
  { href: "/audit-log", key: "auditLog", all: [Permission.VIEW_AUDIT_LOG] },
  // Reading the settings is VIEW_ORG_SETTINGS; changing them, managing users and roles each have their own permission.
  { href: "/settings", key: "settings", all: [Permission.VIEW_ORG_SETTINGS] },
  { href: "/settings/users", key: "users", all: [Permission.MANAGE_ORG_USERS] },
  { href: "/settings/roles", key: "roles", all: [Permission.MANAGE_ROLES] },
  // The simulator approves attendance and prepares test shifts as the signed-in manager.
  { href: "/dev/worker-simulator", key: "workerSimulator", all: [Permission.APPROVE_ATTENDANCE, Permission.MANAGE_SHIFTS], devOnly: true },
];

function isVisible(item: (typeof NAV_ITEMS)[number], access: Access): boolean {
  return (!item.all || access.canAll(item.all)) && (!item.any || access.canAny(item.any));
}

/** The item to highlight: the longest href that is the path or a parent of it (`/attendance/x` is not also `/attendance`'s page when x has its own item). */
function activeHref(pathname: string | null, hrefs: string[]): string | undefined {
  if (!pathname) return undefined;
  return hrefs.filter((href) => pathname === href || pathname.startsWith(`${href}/`)).sort((a, b) => b.length - a.length)[0];
}

/** Sidebar on the inline-start side (the right, since the app is RTL). */
export function Nav() {
  const pathname = usePathname();
  const { session } = useAuth();
  const access = useAccess();
  const roleLabel = useRoleLabel();
  const t = useTranslations("nav");
  const tShell = useTranslations("shell");
  // Same signal as the login page: the API answers 404 (-> null) when dev login is off.
  const devMode = useDevLoginUsers().data != null;
  if (!session) return null;
  const visibleItems = NAV_ITEMS.filter((item) => isVisible(item, access) && (!item.devOnly || devMode));
  const current = activeHref(
    pathname,
    visibleItems.map((item) => item.href),
  );

  return (
    <nav aria-label={t("mainNavigation")} className="flex w-60 shrink-0 flex-col border-e border-slate-200 bg-white px-4 py-6">
      <div className="mb-6 px-2">
        <p className="text-lg font-bold text-slate-900">{tShell("brand")}</p>
        <p className="text-xs text-slate-500">{roleLabel}</p>
      </div>
      <ul className="space-y-1">
        {visibleItems.map((item) => {
          const active = item.href === current;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block rounded-md px-3 py-2 text-start text-sm font-medium",
                  active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100",
                )}
              >
                {t(item.key)}
                {item.devOnly ? (
                  <Badge tone="warning" className="ms-2">
                    {t("testModeBadge")}
                  </Badge>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
