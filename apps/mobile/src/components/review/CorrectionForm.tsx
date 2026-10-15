import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslations } from "use-intl";
import type { ManualCorrectionInput } from "@fieldmaster/api-client";
import { CorrectionReason, TimeEntryStatus } from "@fieldmaster/shared-types";
import { toBusinessDay } from "@fieldmaster/i18n";
import { rawDurationMinutes, splitWorkedMinutes, type DayRules, type WorkedMinutesSplit } from "@fieldmaster/shared-validation";
import { useEnumLabel, useFormat } from "../../i18n/hooks";
import { colors, spacing } from "../../lib/theme";
import { AppText } from "../AppText";
import { AppTextInput } from "../AppTextInput";
import { Button } from "../Button";
import { ChoiceChips } from "./ChoiceChips";
import { JerusalemDateTimeField, toMinute } from "./JerusalemDateTimeField";

/** What a manual correction changes on an existing entry (the admin web's correction types, without "add a missing clock-in": the entry exists). */
export const CorrectionKind = {
  ADD_MISSING_CLOCK_OUT: "ADD_MISSING_CLOCK_OUT",
  CORRECT_CLOCK_IN: "CORRECT_CLOCK_IN",
  CORRECT_CLOCK_OUT: "CORRECT_CLOCK_OUT",
  CORRECT_UNPAID_BREAK: "CORRECT_UNPAID_BREAK",
} as const;
export type CorrectionKind = (typeof CorrectionKind)[keyof typeof CorrectionKind];

/** The entry being corrected (from its evidence). */
export interface CorrectionEntry {
  id: string;
  status: string;
  businessDate: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  rawDurationMinutes: number | null;
  unpaidBreakMinutes: number;
  /** Full-day credit already applied (the split then lifts a short day to a standard day). */
  fullDayCredit: boolean;
  /** The standard day and overtime threshold in force on the entry's business date (the evidence's `dayRules`). */
  dayRules: DayRules;
}

const CORRECTION_REASONS = Object.values(CorrectionReason);
const FORGOTTEN_STAMP_REASONS: readonly string[] = [CorrectionReason.FORGOTTEN_CLOCK_IN, CorrectionReason.FORGOTTEN_CLOCK_OUT];

/** The corrections that apply to the entry as it is now (the admin web's rule): an open entry gets its missing clock-out. */
export function availableCorrections(entry: Pick<CorrectionEntry, "clockOutAt">): CorrectionKind[] {
  return entry.clockOutAt === null
    ? [CorrectionKind.ADD_MISSING_CLOCK_OUT, CorrectionKind.CORRECT_CLOCK_IN]
    : [CorrectionKind.CORRECT_CLOCK_IN, CorrectionKind.CORRECT_CLOCK_OUT, CorrectionKind.CORRECT_UNPAID_BREAK];
}

const isClockIn = (kind: CorrectionKind) => kind === CorrectionKind.CORRECT_CLOCK_IN;
const isBreak = (kind: CorrectionKind) => kind === CorrectionKind.CORRECT_UNPAID_BREAK;

/** The field's starting value: the time being corrected, or now (to the minute). */
function initialTime(kind: CorrectionKind, entry: CorrectionEntry): Date | null {
  if (isBreak(kind)) return null;
  if (kind === CorrectionKind.CORRECT_CLOCK_IN && entry.clockInAt) return toMinute(new Date(entry.clockInAt));
  if (kind === CorrectionKind.CORRECT_CLOCK_OUT && entry.clockOutAt) return toMinute(new Date(entry.clockOutAt));
  return toMinute(new Date());
}

type Field = "time" | "break" | "reason" | "note";
type Split = WorkedMinutesSplit | null;

/**
 * Manual correction (spec section 13), as the admin web does it: add the
 * missing clock-out of an open entry, correct either time, or correct the
 * unpaid break minutes. Only the entry's validated time changes; what the
 * phone and the server recorded stays as evidence. Times are entered in
 * Asia/Jerusalem. Before saving it previews the minutes now and after, split
 * by the shared approval rule (`splitWorkedMinutes`) with the day rules of the
 * entry's own business date -- never constants or defaults.
 */
export function CorrectionForm({
  entry,
  busy,
  disabled = false,
  onSubmit,
  onCancel,
}: {
  entry: CorrectionEntry;
  busy: boolean;
  disabled?: boolean;
  onSubmit: (input: ManualCorrectionInput) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("review.correction");
  const tc = useTranslations("common");
  const enumLabel = useEnumLabel();
  const format = useFormat();
  const kinds = availableCorrections(entry);

  const [kind, setKind] = useState<CorrectionKind>(kinds[0]);
  const [time, setTime] = useState<Date | null>(() => initialTime(kinds[0], entry));
  const [breakMinutes, setBreakMinutes] = useState(String(entry.unpaidBreakMinutes));
  const [reason, setReason] = useState<CorrectionReason | "">("");
  const [note, setNote] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  const minutes = Number(breakMinutes);
  const breakValid = breakMinutes.trim() !== "" && Number.isInteger(minutes) && minutes >= 0;
  const timeValue = time?.getTime() ?? null;

  // The entry's minutes now and after the correction, split by the shared approval rule with the entry's own day rules.
  const preview = useMemo(() => {
    const split = (raw: number | null, unpaid: number): Split =>
      raw === null ? null : splitWorkedMinutes({ rawDurationMinutes: raw, unpaidBreakMinutes: unpaid, fullDayCredit: entry.fullDayCredit }, entry.dayRules);
    const current = split(entry.rawDurationMinutes, entry.unpaidBreakMinutes);
    let orderError: "clockOutBeforeClockIn" | "clockInAfterClockOut" | null = null;
    let next: Split = null;
    if (isBreak(kind)) {
      next = breakValid ? split(entry.rawDurationMinutes, minutes) : null;
    } else if (timeValue !== null && isClockIn(kind)) {
      const clockOut = entry.clockOutAt ? new Date(entry.clockOutAt) : null;
      if (clockOut && timeValue >= clockOut.getTime()) orderError = "clockInAfterClockOut";
      else if (clockOut) next = split(rawDurationMinutes(new Date(timeValue), clockOut), entry.unpaidBreakMinutes);
    } else if (timeValue !== null && entry.clockInAt) {
      const clockIn = new Date(entry.clockInAt);
      if (timeValue <= clockIn.getTime()) orderError = "clockOutBeforeClockIn";
      else next = split(rawDurationMinutes(clockIn, new Date(timeValue)), entry.unpaidBreakMinutes);
    }
    return { current, next, orderError };
  }, [kind, timeValue, breakValid, minutes, entry]);

  const problems: Partial<Record<Field, string>> = {};
  if (isBreak(kind) && !breakValid) problems.break = t("errors.breakInvalid");
  if (!isBreak(kind) && timeValue === null) problems.time = t("errors.timeRequired");
  if (!isBreak(kind) && preview.orderError) problems.time = t(`errors.${preview.orderError}`);
  if (reason === "") problems.reason = t("errors.reasonRequired");
  if (reason === CorrectionReason.OTHER && note.trim() === "") problems.note = t("errors.noteRequired");
  /** The message under each field, only after a save was attempted. */
  const shown: Partial<Record<Field, string>> = showErrors ? problems : {};
  const hasProblems = Object.keys(problems).length > 0;

  function changeKind(next: CorrectionKind) {
    setKind(next);
    setTime(initialTime(next, entry));
  }

  function submit() {
    setShowErrors(true);
    if (hasProblems || reason === "") return;
    const trimmedNote = note.trim();
    const common = { reason, ...(trimmedNote ? { note: trimmedNote } : {}) };
    const input: ManualCorrectionInput = isBreak(kind)
      ? { timeEntryId: entry.id, field: "UNPAID_BREAK_MINUTES", newValue: String(minutes), ...common }
      : { timeEntryId: entry.id, field: isClockIn(kind) ? "CLOCK_IN" : "CLOCK_OUT", newValue: new Date(timeValue as number).toISOString(), ...common };
    onSubmit(input);
  }

  const currentTime = kind === CorrectionKind.CORRECT_CLOCK_IN ? entry.clockInAt : kind === CorrectionKind.CORRECT_CLOCK_OUT ? entry.clockOutAt : null;
  // A forgotten stamp counts in the month the correction is made (shared-validation's forgottenStampInfractionMonth for an existing entry).
  const infractionMonth = reason !== "" && FORGOTTEN_STAMP_REASONS.includes(reason) ? (toBusinessDay(new Date()) ?? "").slice(0, 7) : null;
  const locked = busy || disabled;

  return (
    <View testID="correction-form" style={styles.form}>
      <AppText accessibilityRole="header" weight="bold" size="large">
        {t("title")}
      </AppText>
      <AppText size="small" color={colors.muted}>
        {t("description")}
      </AppText>

      <AppText weight="semibold">{t("type")}</AppText>
      <ChoiceChips label={t("type")} options={kinds.map((value) => ({ value, label: t(`types.${value}`) }))} value={kind} onChange={changeKind} disabled={locked} />

      {isBreak(kind) ? (
        <View style={styles.field}>
          <AppText weight="semibold">{t("breakMinutes")}</AppText>
          <AppTextInput
            testID="correction-break"
            ltr
            keyboardType="number-pad"
            value={breakMinutes}
            onChangeText={setBreakMinutes}
            editable={!locked}
            accessibilityLabel={t("breakMinutes")}
          />
          <AppText size="small" color={colors.muted}>
            {t("currentBreak", { minutes: entry.unpaidBreakMinutes })}
          </AppText>
          {shown.break ? (
            <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
              {shown.break}
            </AppText>
          ) : null}
        </View>
      ) : (
        <View style={styles.field}>
          <JerusalemDateTimeField key={kind} label={t("time")} value={time} onChange={setTime} error={shown.time} disabled={locked} />
          {currentTime ? (
            <AppText size="small" color={colors.muted}>
              {t("currentTime", { time: format.dateTime(currentTime) })}
            </AppText>
          ) : null}
        </View>
      )}

      <View style={styles.field}>
        <AppText weight="semibold">{t("reason")}</AppText>
        <ChoiceChips
          label={t("reason")}
          options={CORRECTION_REASONS.map((value) => ({ value, label: enumLabel("CorrectionReason", value) }))}
          value={reason}
          onChange={setReason}
          disabled={locked}
        />
        {shown.reason ? (
          <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
            {shown.reason}
          </AppText>
        ) : null}
        {infractionMonth ? (
          <AppText size="small" weight="semibold" color={colors.warning}>
            {t("forgottenStamp", { month: format.month(infractionMonth) })}
          </AppText>
        ) : null}
      </View>

      <View style={styles.field}>
        <AppText weight="semibold">{reason === CorrectionReason.OTHER ? t("noteRequired") : t("note")}</AppText>
        <AppTextInput
          testID="correction-note"
          multiline
          value={note}
          onChangeText={setNote}
          editable={!locked}
          accessibilityLabel={reason === CorrectionReason.OTHER ? t("noteRequired") : t("note")}
        />
        {shown.note ? (
          <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
            {shown.note}
          </AppText>
        ) : null}
      </View>

      <MinutesPreview current={preview.current} next={preview.next} entry={entry} kind={kind} />
      {entry.status === TimeEntryStatus.APPROVED ? (
        <AppText size="small" color={colors.warning}>
          {t("preview.approvedNote")}
        </AppText>
      ) : null}

      {showErrors && hasProblems ? (
        <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
          {t("errors.summary")}
        </AppText>
      ) : null}
      <View style={styles.buttons}>
        <Button label={t("submit")} busy={busy} busyLabel={t("submitting")} disabled={disabled} onPress={submit} />
        <Button label={tc("cancel")} variant="secondary" disabled={busy} onPress={onCancel} />
      </View>
    </View>
  );
}

/** The minutes now and after the correction (worked, regular, overtime), with the day rules they come from. */
function MinutesPreview({ current, next, entry, kind }: { current: Split; next: Split; entry: CorrectionEntry; kind: CorrectionKind }) {
  const tPreview = useTranslations("review.correction.preview");
  const format = useFormat();
  const rules = tPreview("rules", {
    date: format.businessDate(entry.businessDate),
    standard: format.minutes(entry.dayRules.standardDayMinutes),
    threshold: format.minutes(entry.dayRules.overtimeThresholdMinutes),
  });
  // A clock-in on an entry without a clock-out leaves it open: nothing to count yet.
  if (entry.clockOutAt === null && isClockIn(kind)) {
    return (
      <View style={styles.preview} testID="correction-preview">
        <AppText weight="semibold">{tPreview("title")}</AppText>
        <AppText color={colors.muted}>{tPreview("stillOpen")}</AppText>
      </View>
    );
  }
  const rows = [
    { key: "worked", label: tPreview("worked"), current: current?.workedMinutes, next: next?.workedMinutes },
    { key: "regular", label: tPreview("regular"), current: current?.regularMinutes, next: next?.regularMinutes },
    { key: "overtime", label: tPreview("overtime"), current: current?.overtimeMinutes, next: next?.overtimeMinutes },
  ];
  return (
    <View style={styles.preview} testID="correction-preview">
      <AppText weight="semibold">{tPreview("title")}</AppText>
      <View style={styles.row}>
        <View style={styles.labelCell} />
        <AppText size="small" color={colors.muted} style={styles.cell}>
          {tPreview("now")}
        </AppText>
        <AppText size="small" color={colors.muted} style={styles.cell}>
          {tPreview("after")}
        </AppText>
      </View>
      {rows.map((row) => (
        <View key={row.key} style={styles.row}>
          <AppText style={styles.labelCell}>{row.label}</AppText>
          <AppText testID={`preview-now-${row.key}`} style={styles.cell}>
            {format.minutes(row.current ?? null)}
          </AppText>
          <AppText testID={`preview-${row.key}`} weight="semibold" style={styles.cell}>
            {format.minutes(row.next ?? null)}
          </AppText>
        </View>
      ))}
      <AppText size="small" color={colors.muted}>
        {rules}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, padding: spacing.md },
  field: { gap: spacing.xs },
  preview: { gap: spacing.xs, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  labelCell: { flex: 1.4 },
  cell: { flex: 1 },
  buttons: { gap: spacing.sm },
});
