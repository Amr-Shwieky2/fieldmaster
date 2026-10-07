import Link from "next/link";
import type { ReactNode } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";

/** Centered full-screen message used by the 404 and error pages (outside the app shell). */
export function FullPageMessage({
  title,
  description,
  linkLabel,
  actions,
}: {
  title: string;
  description: string;
  linkLabel: string;
  actions?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-100 px-4 py-10">
      <div className="flex w-full max-w-md justify-end">
        <LocaleSwitcher />
      </div>
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          {actions}
          <Link href="/dashboard" className="text-sm font-medium text-brand-700 hover:underline">
            {linkLabel}
          </Link>
        </div>
      </div>
    </main>
  );
}
