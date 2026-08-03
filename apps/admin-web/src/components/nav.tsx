"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { OrgRole } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

const NAV_ITEMS: { href: string; label: string; roles: OrgRole[] }[] = [
  { href: "/dashboard", label: "Dashboard", roles: [OrgRole.OWNER, OrgRole.FIELD_MANAGER] },
  { href: "/workers", label: "Workers", roles: [OrgRole.OWNER, OrgRole.FIELD_MANAGER] },
  { href: "/sites", label: "Sites & Projects", roles: [OrgRole.OWNER, OrgRole.FIELD_MANAGER] },
  { href: "/shifts", label: "Scheduling", roles: [OrgRole.OWNER, OrgRole.FIELD_MANAGER] },
  { href: "/turan", label: "Turan & Emergency", roles: [OrgRole.OWNER, OrgRole.FIELD_MANAGER] },
  { href: "/attendance", label: "Attendance Approval", roles: [OrgRole.OWNER, OrgRole.FIELD_MANAGER] },
  // Payroll is intentionally Owner-only -- Field Managers must never see it (spec 6.2 / 23.5).
  { href: "/payroll", label: "Payroll", roles: [OrgRole.OWNER] },
  { href: "/reports", label: "Reports", roles: [OrgRole.OWNER, OrgRole.FIELD_MANAGER] },
  { href: "/notifications", label: "Notifications", roles: [OrgRole.OWNER, OrgRole.FIELD_MANAGER] },
  { href: "/audit-log", label: "Audit Log", roles: [OrgRole.OWNER] },
];

export function Nav() {
  const pathname = usePathname();
  const { session, logout } = useAuth();
  if (!session) return null;

  return (
    <nav className="flex h-full w-60 flex-col justify-between border-r border-slate-200 bg-white px-4 py-6">
      <div>
        <div className="mb-6 px-2">
          <p className="text-lg font-bold text-slate-900">FieldMaster</p>
          <p className="text-xs text-slate-500">{session.role.replace("_", " ")}</p>
        </div>
        <ul className="space-y-1">
          {NAV_ITEMS.filter((item) => item.roles.includes(session.role)).map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "block rounded-md px-3 py-2 text-sm font-medium",
                  pathname?.startsWith(item.href) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100",
                )}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <Button variant="ghost" size="sm" onClick={logout}>
        Sign out
      </Button>
    </nav>
  );
}
