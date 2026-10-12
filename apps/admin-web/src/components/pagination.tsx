"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ChevronEndIcon, ChevronStartIcon } from "@/components/icons";

/**
 * A page past the end -- its last entry was just approved, or an old link --
 * comes back empty with the real total: send it to the last page (page 1 when
 * nothing is left, which then shows the empty state). Returns true until then,
 * so the page shows neither an "empty" state nor stale rows.
 */
export function useLastPageFallback(
  data: { page: number; pageSize: number; total: number; items: unknown[] } | undefined,
  goToPage: (page: number) => void,
): boolean {
  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const pastEnd = data !== undefined && data.items.length === 0 && data.page > lastPage;
  useEffect(() => {
    // goToPage is a new function on every render; only a change of these values matters.
    if (pastEnd) goToPage(lastPage);
  }, [pastEnd, lastPage]);
  return pastEnd;
}

/** Previous / next page with "صفحة {page} من {total}"; hidden when everything fits on one page. */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  label,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  label: string;
}) {
  const tc = useTranslations("common");
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1 && page <= 1) return null;
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3">
      <Button variant="secondary" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
        <ChevronStartIcon />
        {tc("previous")}
      </Button>
      <p className="text-sm text-slate-600" aria-live="polite">
        {tc("pageOf", { page, total: pages })}
      </p>
      <Button variant="secondary" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= pages}>
        {tc("next")}
        <ChevronEndIcon />
      </Button>
    </nav>
  );
}
