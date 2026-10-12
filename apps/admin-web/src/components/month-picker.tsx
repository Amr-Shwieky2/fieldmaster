"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ChevronEndIcon, ChevronStartIcon } from "@/components/icons";
import { MonthText } from "@/components/formatted";
import { YEAR_MONTH_PATTERN, shiftYearMonth } from "@/lib/jerusalem-time";

/** A business month (YYYY-MM, Asia/Jerusalem): previous / month input / next, with the month's Arabic name. */
export function MonthPicker({ value, onChange, label }: { value: string; onChange: (month: string) => void; label: string }) {
  const t = useTranslations("monthPicker");
  const inputId = useId();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Button variant="secondary" size="sm" onClick={() => onChange(shiftYearMonth(value, -1))} aria-label={t("previous")}>
        <ChevronStartIcon />
      </Button>
      <div>
        <Label htmlFor={inputId}>{label}</Label>
        <Input
          id={inputId}
          type="month"
          dir="ltr"
          value={value}
          onChange={(event) => {
            if (YEAR_MONTH_PATTERN.test(event.target.value)) onChange(event.target.value);
          }}
          className="w-44"
        />
      </div>
      <Button variant="secondary" size="sm" onClick={() => onChange(shiftYearMonth(value, 1))} aria-label={t("next")}>
        <ChevronEndIcon />
      </Button>
      <p className="pb-2 text-sm font-medium text-slate-700">
        <MonthText yearMonth={value} />
      </p>
    </div>
  );
}
