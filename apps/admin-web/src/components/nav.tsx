"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { OrgRole } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { useEnumLabel } from "@/i18n/enums";
import { cn } from "@/lib/cn";
import { useDevLoginUsers } from "@/components/dev-quick-login";
import { Badge } from "@/components/ui/badge";

type NavKey =
  | "dashboard"
  | "workers"
  | "sitesProjects"
  | "scheduling"
  | "turanEmergency"
  | "attendanceApproval"
  | "payroll"
  | "reports"
  | "notifications"
  | "auditLog"
  | "workerSimulator";

/** `devOnly` items exist only while the API is in dev login (test) mode; with it off they are not rendered at all. */
const NAV_ITEMS: { href: string; key: NavKey; roles: OrgRole[]; devOnly?: boolean }[] = [
  { href: "/dashboard", key: "dashboard", roles: [OrgRole.OWNER, OrgRole.FIELD_MANAGER] },
  { href: "/workers", key: "workers", roles: [OrgRole.OWNER, OrgRole.FIELD_MANAGER] },
  { href: "/sites", key: "sitesProjects", roles: [OrgRole.OWNER, OrgRole.FIELD_MANAGER] },
  { href: "/shifts", key: "scheduling", roles: [OrgRole.OWNER, OrgRole.FIELD_MANAGER] },
  { href: "/turan", key: "turanEmergency", roles: [OrgRole.OWNER, OrgRole.FIELD_MANAGER] },
  { href: "/attendance", key: "attendanceApproval", roles: [OrgRole.OWNER, OrgRole.FIELD_MANAGER] },
  // Payroll is intentionally Owner-only -- Field Managers must never see it (spec 6.2 / 23.5).
  { href: "/payroll", key: "payroll", roles: [OrgRole.OWNER] },
  { href: "/reports", key: "reports", roles: [OrgRole.OWNER, OrgRole.FIELD_MANAGER] },
  { href: "/notifications", key: "notifications", roles: [OrgRole.OWNER, OrgRole.FIELD_MANAGER] },
  { href: "/audit-log", key: "auditLog", roles: [OrgRole.OWNER] },
  { href: "/dev/worker-simulator", key: "workerSimulator", roles: [OrgRole.OWNER, OrgRole.FIELD_MANAGER], devOnly: true },
];

/** Sidebar on the inline-start side (the right, since the app is RTL). */
export function Nav() {
  const pathname = usePathname();
  const { session } = useAuth();
  const t = useTranslations("nav");
  const tShell = useTranslations("shell");
  const enumLabel = useEnumLabel();
  // Same signal as the login page: the API answers 404 (-> null) when dev login is off.
  const devMode = useDevLoginUsers().data != null;
  if (!session) return null;

  return (
    <nav aria-label={t("mainNavigation")} className="flex w-60 shrink-0 flex-col border-e border-slate-200 bg-white px-4 py-6">
      <div className="mb-6 px-2">
        <p className="text-lg font-bold text-slate-900">{tShell("brand")}</p>
        <p className="text-xs text-slate-500">{enumLabel("OrgRole", session.role)}</p>
      </div>
      <ul className="space-y-1">
        {NAV_ITEMS.filter((item) => item.roles.includes(session.role) && (!item.devOnly || devMode)).map((item) => {
          const active = pathname?.startsWith(item.href) ?? false;
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
