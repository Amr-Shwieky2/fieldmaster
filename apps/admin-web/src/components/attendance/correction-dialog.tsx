"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { ManualCorrectionInput, Shift } from "@fieldmaster/api-client";
import { CorrectionReason, DEFAULT_WORK_RULES, Permission, ShiftType, TimeEntryStatus } from "@fieldmaster/shared-types";
import {
  evaluateForgottenStampInfraction,
  forgottenStampInfractionMonth,
  rawDurationMinutes,
  splitWorkedMinutes,
  type DayRules,
} from "@fieldmaster/shared-validation";
import { useAuth } from "@/lib/auth-context";
import { useAccess } from "@/lib/use-access";
import { useErrorMessage } from "@/lib/use-error-message";
import { useEnumLabel } from "@/i18n/enums";
import { useShiftTitle } from "@/lib/shift-title";
import { useFormat } from "@/lib/use-format";
import { fromJerusalemInputValue, toJerusalemInputValue } from "@/lib/jerusalem-time";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { DateTimeText, MinutesText, Money, MonthText } from "@/components/formatted";
import { useInvalidateAttendance } from "./entry-actions";

export const CorrectionKind = {
  ADD_MISSING_CLOCK_IN: "ADD_MISSING_CLOCK_IN",
  ADD_MISSING_CLOCK_OUT: "ADD_MISSING_CLOCK_OUT",
  CORRECT_CLOCK_IN: "CORRECT_CLOCK_IN",
  CORRECT_CLOCK_OUT: "CORRECT_CLOCK_OUT",
  CORRECT_UNPAID_BREAK: "CORRECT_UNPAID_BREAK",
} as const;
export type CorrectionKind = (typeof CorrectionKind)[keyof typeof CorrectionKind];

/** The entry being corrected (absent when a missing clock-in creates a new entry). */
export interface CorrectionEntry {
  id: string;
  workerProfileId: string;
  workerName: string;
  status: TimeEntryStatus;
  clockInAt: string | null;
  clockOutAt: string | null;
  rawDurationMinutes: number | null;
  unpaidBreakMinutes: number;
  fullDayCredit: boolean;
  /** The standard day and overtime threshold in force on the entry's business date (the evidence's `dayRules`); the defaults when absent. */
  dayRules?: DayRules;
}

const FORGOTTEN_STAMP_REASONS: CorrectionReason[] = [CorrectionReason.FORGOTTEN_CLOCK_IN, CorrectionReason.FORGOTTEN_CLOCK_OUT];

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** The dialog's elements that Tab can reach, in order (of a radio group, only its checked radio). */
function tabbable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.hasAttribute("disabled") && !(element instanceof HTMLInputElement && element.type === "radio" && !element.checked),
  );
}

/** Fields that can carry a validation message. */
const FIELDS = ["worker", "shift", "time", "break", "reason", "note"] as const;
type Field = (typeof FIELDS)[number];

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-red-600">
      {message}
    </p>
  );
}

/** The corrections that apply to an entry as it is now; a new entry can only start with a missing clock-in. */
export function availableCorrections(entry: CorrectionEntry | undefined): CorrectionKind[] {
  if (!entry) return [CorrectionKind.ADD_MISSING_CLOCK_IN];
  return entry.clockOutAt === null
    ? [CorrectionKind.ADD_MISSING_CLOCK_OUT, CorrectionKind.CORRECT_CLOCK_IN]
    : [CorrectionKind.CORRECT_CLOCK_IN, CorrectionKind.CORRECT_CLOCK_OUT, CorrectionKind.CORRECT_UNPAID_BREAK];
}

const isClockIn = (kind: CorrectionKind) => kind === CorrectionKind.ADD_MISSING_CLOCK_IN || kind === CorrectionKind.CORRECT_CLOCK_IN;
const isBreak = (kind: CorrectionKind) => kind === CorrectionKind.CORRECT_UNPAID_BREAK;

/** The input's starting value for a time correction: the time being corrected, or now. */
function initialTime(kind: CorrectionKind, entry: CorrectionEntry | undefined, shift: Shift | undefined): string {
  if (kind === CorrectionKind.CORRECT_CLOCK_IN && entry?.clockInAt) return toJerusalemInputValue(entry.clockInAt);
  if (kind === CorrectionKind.CORRECT_CLOCK_OUT && entry?.clockOutAt) return toJerusalemInputValue(entry.clockOutAt);
  if (kind === CorrectionKind.ADD_MISSING_CLOCK_IN && shift) return toJerusalemInputValue(shift.scheduledStart);
  return toJerusalemInputValue(new Date());
}

/**
 * Manual correction (spec section 13): add a missing clock-in or clock-out,
 * correct either time, or correct the unpaid break minutes. Only the entry's
 * validated time changes; what the phone and the server recorded stays as
 * evidence. Before saving it previews the new minutes with the same shared
 * functions approval uses (with the day rules of the entry's own business
 * date), and, for a forgotten stamp, which infraction of the month this will
 * be (a member who may see money also sees the deduction from the third).
 */
export function CorrectionDialog({ entry, onClose, onSaved }: { entry?: CorrectionEntry; onClose: () => void; onSaved: (timeEntryId: string) => void }) {
  const t = useTranslations("correction");
  const label = useEnumLabel();
  const errorMessage = useErrorMessage();
  const shiftTitle = useShiftTitle();
  const format = useFormat();
  const { client } = useAuth();
  const { can } = useAccess();
  const invalidate = useInvalidateAttendance();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const isCreate = entry === undefined;
  const kinds = availableCorrections(entry);

  const [kind, setKind] = useState<CorrectionKind>(kinds[0]);
  const [workerProfileId, setWorkerProfileId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [time, setTime] = useState(() => initialTime(kinds[0], entry, undefined));
  const [breakMinutes, setBreakMinutes] = useState(String(entry?.unpaidBreakMinutes ?? 0));
  const [reason, setReason] = useState<CorrectionReason | "">("");
  const [note, setNote] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  const workersQuery = useQuery({ queryKey: ["workers"], queryFn: () => client.listWorkers(), enabled: isCreate });
  const shiftsQuery = useQuery({ queryKey: ["shifts"], queryFn: () => client.listShifts(), enabled: isCreate });
  const workerShifts = useMemo(
    () =>
      (shiftsQuery.data ?? []).filter(
        (shift) =>
          shift.shiftType !== ShiftType.EMERGENCY_CALLOUT && (shift.assignments ?? []).some((assignment) => assignment.workerProfileId === workerProfileId),
      ),
    [shiftsQuery.data, workerProfileId],
  );

  useEffect(() => {
    // Focus moves into the dialog, and back to what opened it (the تصحيح يدوي button) when it closes.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstFieldRef.current?.focus();
    return () => opener?.focus();
  }, []);

  const instant = isBreak(kind) ? null : fromJerusalemInputValue(time);
  const minutes = Number(breakMinutes);
  const breakValid = breakMinutes.trim() !== "" && Number.isInteger(minutes) && minutes >= 0;

  // The preview: the entry's minutes now and after the correction, split by the shared approval rule with the entry's own day rules.
  const preview = useMemo(() => {
    const dayRules = entry?.dayRules ?? DEFAULT_WORK_RULES;
    const split = (raw: number | null, unpaid: number) =>
      raw === null ? null : splitWorkedMinutes({ rawDurationMinutes: raw, unpaidBreakMinutes: unpaid, fullDayCredit: entry?.fullDayCredit ?? false }, dayRules);
    const current = entry ? split(entry.rawDurationMinutes, entry.unpaidBreakMinutes) : null;
    let orderError: "clockOutBeforeClockIn" | "clockInAfterClockOut" | null = null;
    let next: ReturnType<typeof split> = null;
    if (isBreak(kind)) {
      next = breakValid && entry ? split(entry.rawDurationMinutes, minutes) : null;
    } else if (instant && isClockIn(kind)) {
      const clockOut = entry?.clockOutAt ? new Date(entry.clockOutAt) : null;
      if (clockOut && instant.getTime() >= clockOut.getTime()) orderError = "clockInAfterClockOut";
      else if (clockOut) next = split(rawDurationMinutes(instant, clockOut), entry?.unpaidBreakMinutes ?? 0);
    } else if (instant && entry?.clockInAt) {
      const clockIn = new Date(entry.clockInAt);
      if (instant.getTime() <= clockIn.getTime()) orderError = "clockOutBeforeClockIn";
      else next = split(rawDurationMinutes(clockIn, instant), entry.unpaidBreakMinutes);
    }
    return { current, next, orderError };
  }, [kind, instant?.getTime(), breakValid, minutes, entry]);

  // A forgotten stamp counts as an infraction in this month (the shared rule the API applies).
  const subjectWorkerId = entry?.workerProfileId ?? workerProfileId;
  const isForgottenStamp = reason !== "" && FORGOTTEN_STAMP_REASONS.includes(reason);
  const infractionMonth =
    isForgottenStamp && (!isCreate || instant) ? forgottenStampInfractionMonth({ createsTimeEntry: isCreate, clockInAt: instant ?? undefined }) : null;
  const infractionsQuery = useQuery({
    queryKey: ["forgotten-stamps", { workerProfileId: subjectWorkerId, month: infractionMonth }],
    queryFn: () => client.listForgottenStampInfractions({ workerProfileId: subjectWorkerId, month: infractionMonth! }),
    enabled: infractionMonth !== null && subjectWorkerId !== "",
  });
  const infractionNumber = infractionsQuery.data ? infractionsQuery.data.length + 1 : null;
  const deductionAgorot = infractionNumber !== null ? evaluateForgottenStampInfraction(infractionNumber).deductionAgorot : 0;

  const problems: Partial<Record<Field, string>> = {};
  if (isCreate && !workerProfileId) problems.worker = t("errors.workerRequired");
  if (isCreate && !shiftId) problems.shift = t("errors.shiftRequired");
  if (isBreak(kind) && !breakValid) problems.break = t("errors.breakInvalid");
  if (!isBreak(kind) && !instant) problems.time = t("errors.timeRequired");
  if (!isBreak(kind) && preview.orderError) problems.time = t(`errors.${preview.orderError}`);
  if (reason === "") problems.reason = t("errors.reasonRequired");
  if (reason === CorrectionReason.OTHER && note.trim() === "") problems.note = t("errors.noteRequired");

  const save = useMutation({
    mutationFn: (input: ManualCorrectionInput) => client.createManualCorrection(input),
    onSuccess: async (result) => {
      await invalidate(result.timeEntry.id);
      onSaved(result.timeEntry.id);
    },
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Escape closes like the إغلاق button, which is disabled while the correction is being saved.
      if (event.key === "Escape") {
        if (!save.isPending) onClose();
        return;
      }
      // The dialog is modal: Tab and Shift+Tab cycle through its own fields and buttons.
      const dialog = dialogRef.current;
      if (event.key !== "Tab" || !dialog) return;
      const elements = tabbable(dialog);
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      const inside = dialog.contains(document.activeElement);
      if (event.shiftKey && (!inside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, save.isPending]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setShowErrors(true);
    if (Object.keys(problems).length > 0 || reason === "") return;
    const trimmedNote = note.trim();
    const common = { reason, ...(trimmedNote ? { note: trimmedNote } : {}) };
    let input: ManualCorrectionInput;
    if (!entry) input = { shiftId, workerProfileId, field: "CLOCK_IN", newValue: instant!.toISOString(), ...common };
    else if (isBreak(kind)) input = { timeEntryId: entry.id, field: "UNPAID_BREAK_MINUTES", newValue: String(minutes), ...common };
    else input = { timeEntryId: entry.id, field: isClockIn(kind) ? "CLOCK_IN" : "CLOCK_OUT", newValue: instant!.toISOString(), ...common };
    save.mutate(input);
  };

  /** The message shown under each field (only after a submit attempt) and the id that links it to the field. */
  const shown = Object.fromEntries(FIELDS.map((field) => [field, showErrors ? problems[field] : undefined])) as Partial<Record<Field, string>>;
  const errorId = Object.fromEntries(FIELDS.map((field) => [field, `${titleId}-${field}-error`])) as Record<Field, string>;
  const describedBy = Object.fromEntries(FIELDS.map((field) => [field, shown[field] ? errorId[field] : undefined])) as Partial<Record<Field, string>>;

  const changeKind = (next: CorrectionKind) => {
    setKind(next);
    if (!isBreak(next)) setTime(initialTime(next, entry, undefined));
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">
          {isCreate ? t("titleCreate") : t("title")}
        </h2>
        {entry ? <p className="mt-1 text-sm text-slate-600">{entry.workerName}</p> : null}
        <p className="mt-2 text-sm text-slate-500">{t("description")}</p>

        <form noValidate onSubmit={submit} className="mt-4 space-y-4">
          {isCreate ? (
            <>
              <div>
                <Label htmlFor={`${titleId}-worker`}>{t("worker")}</Label>
                <Select
                  id={`${titleId}-worker`}
                  ref={(element) => {
                    firstFieldRef.current = element;
                  }}
                  value={workerProfileId}
                  onChange={(event) => {
                    setWorkerProfileId(event.target.value);
                    setShiftId("");
                  }}
                  aria-invalid={Boolean(shown.worker) || undefined}
                  aria-describedby={describedBy.worker}
                >
                  <option value="">{t("workerPlaceholder")}</option>
                  {(workersQuery.data ?? []).map((worker) => (
                    <option key={worker.id} value={worker.id}>
                      {worker.fullLegalName}
                    </option>
                  ))}
                </Select>
                <FieldError id={errorId.worker} message={shown.worker} />
              </div>
              <div>
                <Label htmlFor={`${titleId}-shift`}>{t("shift")}</Label>
                <Select
                  id={`${titleId}-shift`}
                  value={shiftId}
                  disabled={!workerProfileId}
                  onChange={(event) => {
                    setShiftId(event.target.value);
                    const shift = workerShifts.find((candidate) => candidate.id === event.target.value);
                    if (shift) setTime(initialTime(CorrectionKind.ADD_MISSING_CLOCK_IN, undefined, shift));
                  }}
                  aria-invalid={Boolean(shown.shift) || undefined}
                  aria-describedby={describedBy.shift}
                >
                  <option value="">{t("shiftPlaceholder")}</option>
                  {workerShifts.map((shift) => (
                    <option key={shift.id} value={shift.id}>
                      {t("shiftOption", { title: shiftTitle(shift), date: format.businessDate(shift.businessDate) })}
                    </option>
                  ))}
                </Select>
                {workerProfileId && shiftsQuery.isSuccess && workerShifts.length === 0 ? <p className="mt-1 text-xs text-slate-500">{t("noShifts")}</p> : null}
                <FieldError id={errorId.shift} message={shown.shift} />
              </div>
            </>
          ) : (
            <fieldset>
              <legend className="mb-1 block text-sm font-medium text-slate-700">{t("type")}</legend>
              <div className="space-y-1">
                {kinds.map((option, index) => (
                  <label key={option} className="flex items-center gap-2 text-sm text-slate-800">
                    <input
                      type="radio"
                      name={`${titleId}-kind`}
                      value={option}
                      checked={kind === option}
                      onChange={() => changeKind(option)}
                      ref={
                        index === 0
                          ? (element) => {
                              firstFieldRef.current = element;
                            }
                          : undefined
                      }
                    />
                    {t(`types.${option}`)}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {isBreak(kind) ? (
            <div>
              <Label htmlFor={`${titleId}-break`}>{t("breakMinutes")}</Label>
              <Input
                id={`${titleId}-break`}
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                dir="ltr"
                value={breakMinutes}
                onChange={(event) => setBreakMinutes(event.target.value)}
                aria-invalid={Boolean(shown.break) || undefined}
                aria-describedby={describedBy.break}
                className="w-40"
              />
              {entry ? <p className="mt-1 text-xs text-slate-500">{t("currentBreak", { minutes: entry.unpaidBreakMinutes })}</p> : null}
              <FieldError id={errorId.break} message={shown.break} />
            </div>
          ) : (
            <div>
              <Label htmlFor={`${titleId}-time`}>{t("time")}</Label>
              <Input
                id={`${titleId}-time`}
                type="datetime-local"
                dir="ltr"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                aria-invalid={Boolean(shown.time) || undefined}
                aria-describedby={describedBy.time}
                className="w-64"
              />
              {entry && isClockIn(kind) && entry.clockInAt ? (
                <p className="mt-1 text-xs text-slate-500">{t.rich("currentTime", { time: () => <DateTimeText value={entry.clockInAt} /> })}</p>
              ) : null}
              {entry && kind === CorrectionKind.CORRECT_CLOCK_OUT && entry.clockOutAt ? (
                <p className="mt-1 text-xs text-slate-500">{t.rich("currentTime", { time: () => <DateTimeText value={entry.clockOutAt} /> })}</p>
              ) : null}
              <FieldError id={errorId.time} message={shown.time} />
            </div>
          )}

          <div>
            <Label htmlFor={`${titleId}-reason`}>{t("reason")}</Label>
            <Select
              id={`${titleId}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value as CorrectionReason | "")}
              aria-invalid={Boolean(shown.reason) || undefined}
              aria-describedby={describedBy.reason}
            >
              <option value="">{t("reasonPlaceholder")}</option>
              {Object.values(CorrectionReason).map((value) => (
                <option key={value} value={value}>
                  {label("CorrectionReason", value)}
                </option>
              ))}
            </Select>
            <FieldError id={errorId.reason} message={shown.reason} />
          </div>

          <div>
            <Label htmlFor={`${titleId}-note`}>{reason === CorrectionReason.OTHER ? t("noteRequired") : t("note")}</Label>
            <textarea
              id={`${titleId}-note`}
              dir="auto"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-invalid={Boolean(shown.note) || undefined}
              aria-describedby={describedBy.note}
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <FieldError id={errorId.note} message={shown.note} />
          </div>

          {isForgottenStamp ? (
            <div role="status" aria-live="polite" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {infractionsQuery.isFetching && infractionNumber === null ? (
                <p>{t("infraction.loading")}</p>
              ) : infractionsQuery.isError ? (
                <p>{t("infraction.failed")}</p>
              ) : infractionNumber !== null && infractionMonth ? (
                <>
                  <p className="font-medium">{t("infraction.number", { number: infractionNumber })}</p>
                  <p>{t.rich("infraction.month", { month: () => <MonthText yearMonth={infractionMonth} /> })}</p>
                  {/* Money: the deduction, only for a member who may see money; anyone else sees the count alone. */}
                  {can(Permission.VIEW_FINANCIALS) && deductionAgorot > 0 ? (
                    <p className="font-medium">{t.rich("infraction.deduction", { money: () => <Money agorot={deductionAgorot} /> })}</p>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          <PreviewTable current={preview.current} next={preview.next} entryOpen={entry ? entry.clockOutAt === null : true} kind={kind} />
          {entry?.status === TimeEntryStatus.APPROVED ? <p className="text-xs text-amber-800">{t("preview.approvedNote")}</p> : null}

          {save.isError ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage(save.error)}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t("submitting") : t("submit")}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
              {t("close")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

type Split = ReturnType<typeof splitWorkedMinutes> | null;

function PreviewTable({ current, next, entryOpen, kind }: { current: Split; next: Split; entryOpen: boolean; kind: CorrectionKind }) {
  const t = useTranslations("correction");
  // A clock-in on an entry without a clock-out leaves it open: nothing to count yet.
  if (entryOpen && isClockIn(kind)) return <p className="text-sm text-slate-500">{t("preview.stillOpen")}</p>;
  const rows: { key: string; label: string; current: number | null | undefined; next: number | null | undefined }[] = [
    { key: "worked", label: t("preview.worked"), current: current?.workedMinutes, next: next?.workedMinutes },
    { key: "regular", label: t("preview.regular"), current: current?.regularMinutes, next: next?.regularMinutes },
    { key: "overtime", label: t("preview.overtime"), current: current?.overtimeMinutes, next: next?.overtimeMinutes },
  ];
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="w-full text-sm">
        <caption className="bg-slate-50 px-3 py-2 text-start font-medium text-slate-700">{t("preview.title")}</caption>
        <thead>
          <tr className="text-slate-500">
            <th scope="col" className="px-3 py-1 text-start font-normal" />
            <th scope="col" className="px-3 py-1 text-start font-normal">
              {t("preview.now")}
            </th>
            <th scope="col" className="px-3 py-1 text-start font-normal">
              {t("preview.after")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-slate-100">
              <th scope="row" className="px-3 py-1 text-start font-normal text-slate-600">
                {row.label}
              </th>
              <td className="px-3 py-1">
                <MinutesText minutes={row.current ?? null} />
              </td>
              <td className="px-3 py-1 font-medium" data-testid={`preview-${row.key}`}>
                <MinutesText minutes={row.next ?? null} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
