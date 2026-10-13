"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { CreatePayrollAdjustmentInput } from "@fieldmaster/api-client";
import { AccountStatus, PayrollAdjustmentType } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { useErrorMessage } from "@/lib/use-error-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { parseShekelsToAgorot } from "./parse-shekels";
import { invalidatePayrollMonth } from "./payroll-queries";

type ManualType = CreatePayrollAdjustmentInput["type"];
const TYPES: ManualType[] = [PayrollAdjustmentType.MANUAL_BONUS, PayrollAdjustmentType.MANUAL_DEDUCTION];

type Field = "worker" | "amount" | "reason";

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-red-600">
      {message}
    </p>
  );
}

/**
 * A manual bonus (إضافة) or deduction (خصم) for one worker of the month.
 * The amount is typed in shekels and sent as integer agorot (the type gives
 * the sign); a reason is required. It is saved at once and counts from the
 * next calculation. The workers offered are the version's workers and every
 * active worker of the organization.
 */
export function AdjustmentForm({ yearMonth, versionWorkers }: { yearMonth: string; versionWorkers: { workerProfileId: string; fullLegalName: string }[] }) {
  const t = useTranslations("payroll.adjustmentForm");
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const id = useId();
  const workersQuery = useQuery({ queryKey: ["workers"], queryFn: () => client.listWorkers() });

  const [workerProfileId, setWorkerProfileId] = useState("");
  const [type, setType] = useState<ManualType>(PayrollAdjustmentType.MANUAL_BONUS);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [added, setAdded] = useState(false);

  const options = useMemo(() => {
    const names = new Map<string, string>();
    for (const worker of versionWorkers) names.set(worker.workerProfileId, worker.fullLegalName);
    for (const worker of workersQuery.data ?? []) {
      if (worker.accountStatus === AccountStatus.ACTIVE && !names.has(worker.id)) names.set(worker.id, worker.fullLegalName);
    }
    return [...names].map(([value, name]) => ({ value, name })).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [versionWorkers, workersQuery.data]);

  const parsed = parseShekelsToAgorot(amount);
  const problems: Partial<Record<Field, string>> = {};
  if (!workerProfileId) problems.worker = t("errors.worker");
  if (!parsed.ok) problems.amount = t(`errors.amount.${parsed.error}`);
  if (reason.trim() === "") problems.reason = t("errors.reason");
  // Shown after the first submit, then kept up to date while the fields change.
  const visible: Partial<Record<Field, string>> = showErrors ? problems : {};
  const describedBy = (field: Field, hint?: string) => [hint, visible[field] ? `${id}-${field}-error` : undefined].filter(Boolean).join(" ") || undefined;

  const create = useMutation({
    mutationFn: (input: CreatePayrollAdjustmentInput) => client.createPayrollAdjustment(yearMonth, input),
    onSuccess: () => {
      setWorkerProfileId("");
      setType(PayrollAdjustmentType.MANUAL_BONUS);
      setAmount("");
      setReason("");
      setShowErrors(false);
      setAdded(true);
      void invalidatePayrollMonth(queryClient, yearMonth);
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAdded(false);
    if (!parsed.ok || Object.keys(problems).length > 0) {
      setShowErrors(true);
      return;
    }
    create.mutate({ workerProfileId, type, amountAgorot: parsed.agorot, reason: reason.trim() });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <p className="mt-1 text-sm text-slate-500">{t("description")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <form noValidate onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor={`${id}-worker`}>{t("worker")}</Label>
            <Select
              id={`${id}-worker`}
              value={workerProfileId}
              onChange={(event) => setWorkerProfileId(event.target.value)}
              aria-invalid={visible.worker ? true : undefined}
              aria-describedby={describedBy("worker")}
            >
              <option value="">{t("workerPlaceholder")}</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.name}
                </option>
              ))}
            </Select>
            <FieldError id={`${id}-worker-error`} message={visible.worker} />
          </div>

          <fieldset>
            <legend className="mb-1 block text-sm font-medium text-slate-700">{t("type")}</legend>
            <div className="flex flex-wrap gap-4 py-2">
              {TYPES.map((option) => (
                <label key={option} className="inline-flex items-center gap-2 text-sm text-slate-800">
                  <input type="radio" name={`${id}-type`} value={option} checked={type === option} onChange={() => setType(option)} />
                  {option === PayrollAdjustmentType.MANUAL_BONUS ? t("bonus") : t("deduction")}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <Label htmlFor={`${id}-amount`}>{t("amount")}</Label>
            <Input
              id={`${id}-amount`}
              type="text"
              inputMode="decimal"
              dir="ltr"
              autoComplete="off"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-invalid={visible.amount ? true : undefined}
              aria-describedby={describedBy("amount", `${id}-amount-hint`)}
            />
            <p id={`${id}-amount-hint`} className="mt-1 text-xs text-slate-500">
              {t("amountHint")}
            </p>
            <FieldError id={`${id}-amount-error`} message={visible.amount} />
          </div>

          <div className="md:col-span-2">
            <Label htmlFor={`${id}-reason`}>{t("reason")}</Label>
            <textarea
              id={`${id}-reason`}
              dir="auto"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-invalid={visible.reason ? true : undefined}
              aria-describedby={describedBy("reason", `${id}-reason-hint`)}
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <p id={`${id}-reason-hint`} className="mt-1 text-xs text-slate-500">
              {t("reasonHint")}
            </p>
            <FieldError id={`${id}-reason-error`} message={visible.reason} />
          </div>

          <div className="md:col-span-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t("pending") : t("submit")}
            </Button>
          </div>
        </form>

        <div aria-live="polite">
          {added ? (
            <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {t("success")}
            </p>
          ) : null}
        </div>
        {create.isError ? (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage(create.error)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
