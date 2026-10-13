"use client";

import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { CreateReportInput, GeneratedReport } from "@fieldmaster/api-client";
import { AccountStatus, OrgRole, ReportType } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { currentYearMonth } from "@/lib/business-date";
import { YEAR_MONTH_PATTERN, monthDateRange } from "@/lib/jerusalem-time";
import { useErrorMessage } from "@/lib/use-error-message";
import { useFormat } from "@/lib/use-format";
import { useEnumLabel } from "@/i18n/enums";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { newIdempotencyKey, payrollKeys } from "@/components/payroll/payroll-queries";
import { CurrentReport } from "./current-report";
import {
  REPORT_FORM_FIELDS,
  buildReportInput,
  defaultPayrollMonth,
  defaultPayrollVersion,
  filtersFor,
  isReportableVersion,
  reportTypesFor,
  validateReportForm,
  type ReportFormField,
  type ReportFormValues,
} from "./report-model";
import { reportKeys } from "./report-queries";

/** A new form: the worker ledger over the current business month (Asia/Jerusalem). */
function initialValues(): ReportFormValues {
  const { from, to } = monthDateRange(currentYearMonth());
  return {
    reportType: ReportType.WORKER_ATTENDANCE_LEDGER,
    fromDate: from,
    toDate: to,
    workerProfileId: "",
    projectId: "",
    siteId: "",
    yearMonth: "",
    version: "",
  };
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-xs text-red-600">
      {message}
    </p>
  );
}

/** A list the form needs could not be loaded: the translated reason and a retry. */
function ListError({ query }: { query: UseQueryResult<unknown> }) {
  const t = useTranslations("reports");
  const tc = useTranslations("common");
  const errorMessage = useErrorMessage();
  if (!query.isError) return null;
  return (
    <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-red-700">
      <span>{t("create.listError", { message: errorMessage(query.error) })}</span>
      <Button type="button" size="sm" variant="secondary" onClick={() => void query.refetch()}>
        {tc("retry")}
      </Button>
    </div>
  );
}

/**
 * «إنشاء تقرير»: the report type and its filters, checked before anything is
 * sent. «إنشاء التقرير» starts a background job (one Idempotency-Key per
 * click) and the report's progress, files and integrity check appear below.
 * An Owner gets the financial copy of every report and may request the
 * payroll report; a Field Manager gets the operational copy, without money.
 */
export function CreateReportCard() {
  const t = useTranslations("reports");
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const format = useFormat();
  const { client, session } = useAuth();
  const queryClient = useQueryClient();
  const id = useId();
  const isOwner = session?.role === OrgRole.OWNER;
  const types = reportTypesFor(isOwner);

  const [values, setValues] = useState<ReportFormValues>(initialValues);
  const [showErrors, setShowErrors] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const update = (patch: Partial<ReportFormValues>) => setValues((previous) => ({ ...previous, ...patch }));

  const reportType = types.includes(values.reportType) ? values.reportType : types[0];
  const fields = filtersFor(reportType);

  const workersQuery = useQuery({ queryKey: ["workers"], queryFn: () => client.listWorkers() });
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => client.listProjects() });
  const sitesQuery = useQuery({ queryKey: ["sites"], queryFn: () => client.listSites() });
  const periodsQuery = useQuery({ queryKey: payrollKeys.periods, queryFn: () => client.listPayrollPeriods(), enabled: isOwner && fields.payroll });
  const yearMonth = values.yearMonth || defaultPayrollMonth(periodsQuery.data);
  const versionsQuery = useQuery({
    queryKey: payrollKeys.versions(yearMonth),
    queryFn: () => client.listPayrollVersions(yearMonth),
    enabled: isOwner && fields.payroll && YEAR_MONTH_PATTERN.test(yearMonth),
  });
  const version = values.version || defaultPayrollVersion(versionsQuery.data);

  const workers = useMemo(() => [...(workersQuery.data ?? [])].sort((a, b) => a.fullLegalName.localeCompare(b.fullLegalName, "ar")), [workersQuery.data]);
  const projects = useMemo(() => [...(projectsQuery.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, "ar")), [projectsQuery.data]);
  const sites = useMemo(
    () => (sitesQuery.data ?? []).filter((site) => site.projectId === values.projectId).sort((a, b) => a.name.localeCompare(b.name, "ar")),
    [sitesQuery.data, values.projectId],
  );
  const months = useMemo(() => [...(periodsQuery.data ?? [])].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth)), [periodsQuery.data]);
  const versions = useMemo(() => [...(versionsQuery.data ?? [])].sort((a, b) => b.version - a.version), [versionsQuery.data]);

  const effective: ReportFormValues = { ...values, reportType, yearMonth, version };
  const problems = validateReportForm(effective);
  const visible = showErrors ? problems : {};
  const fieldId = (field: ReportFormField) => `${id}-${field}`;
  const errorId = (field: ReportFormField) => `${id}-${field}-error`;
  // Per checked field: its invalid state for assistive technology, and its message.
  const a11y = {} as Record<ReportFormField, { "aria-invalid": true | undefined; "aria-describedby": string | undefined }>;
  const errors = {} as Record<ReportFormField, ReactNode>;
  for (const field of REPORT_FORM_FIELDS) {
    const problem = visible[field];
    a11y[field] = { "aria-invalid": problem ? true : undefined, "aria-describedby": problem ? errorId(field) : undefined };
    errors[field] = <FieldError id={errorId(field)} message={problem ? t(`create.errors.${problem}`) : undefined} />;
  }

  const create = useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: CreateReportInput; idempotencyKey: string }) => client.createReport(input, idempotencyKey),
    onSuccess: (report) => {
      queryClient.setQueryData(reportKeys.detail(report.id), report);
      setCurrentId(report.id);
      void queryClient.invalidateQueries({ queryKey: reportKeys.list });
    },
  });
  // A new key for every click: the same key would answer with the same report.
  const start = (input: CreateReportInput) => create.mutate({ input, idempotencyKey: newIdempotencyKey() });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const firstProblem = REPORT_FORM_FIELDS.find((field) => problems[field]);
    if (firstProblem) {
      setShowErrors(true);
      document.getElementById(fieldId(firstProblem))?.focus();
      return;
    }
    setShowErrors(false);
    start(buildReportInput(effective));
  };
  const retry = (report: GeneratedReport) => start({ reportType: report.reportType, filters: report.filters });

  const workerPlaceholder = workersQuery.isPending
    ? t("create.workersLoading")
    : fields.worker === "required"
      ? workers.length === 0 && workersQuery.isSuccess
        ? t("create.noWorkers")
        : t("create.workerPlaceholder")
      : t("create.allWorkers");

  let filterFields: ReactNode = null;
  if (fields.payroll) {
    filterFields = (
      <>
        <div>
          <Label htmlFor={fieldId("yearMonth")}>{t("create.month")}</Label>
          <Select
            id={fieldId("yearMonth")}
            value={yearMonth}
            onChange={(event) => update({ yearMonth: event.target.value, version: "" })}
            disabled={periodsQuery.isPending}
            {...a11y.yearMonth}
          >
            <option value="">{periodsQuery.isPending ? t("create.listLoading") : t("create.monthPlaceholder")}</option>
            {months.map((period) => (
              <option key={period.yearMonth} value={period.yearMonth}>
                {format.month(period.yearMonth)}
              </option>
            ))}
          </Select>
          {periodsQuery.isSuccess && months.length === 0 ? <p className="mt-1 text-xs text-slate-500">{t("create.noPayrollMonths")}</p> : null}
          <ListError query={periodsQuery} />
          {errors.yearMonth}
        </div>
        <div>
          <Label htmlFor={fieldId("version")}>{t("create.version")}</Label>
          <Select
            id={fieldId("version")}
            value={version}
            onChange={(event) => update({ version: event.target.value })}
            disabled={yearMonth === "" || versionsQuery.isPending}
            {...a11y.version}
          >
            <option value="">{yearMonth !== "" && versionsQuery.isPending ? t("create.listLoading") : t("create.versionPlaceholder")}</option>
            {versions.map((option) => (
              <option key={option.version} value={String(option.version)} disabled={!isReportableVersion(option)}>
                {isReportableVersion(option)
                  ? t("create.versionOption", { version: option.version, status: enumLabel("PayrollPeriodStatus", option.status) })
                  : t("create.versionNotCalculated", { version: option.version })}
              </option>
            ))}
          </Select>
          <ListError query={versionsQuery} />
          {errors.version}
        </div>
      </>
    );
  } else {
    filterFields = (
      <>
        {fields.worker !== null ? (
          <div className="md:col-span-2">
            <Label htmlFor={fieldId("workerProfileId")}>{t("create.worker")}</Label>
            <Select
              id={fieldId("workerProfileId")}
              value={values.workerProfileId}
              onChange={(event) => update({ workerProfileId: event.target.value })}
              disabled={workersQuery.isPending}
              {...a11y.workerProfileId}
            >
              <option value="">{workerPlaceholder}</option>
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.accountStatus === AccountStatus.ACTIVE
                    ? worker.fullLegalName
                    : t("create.workerWithStatus", { name: worker.fullLegalName, status: enumLabel("AccountStatus", worker.accountStatus) })}
                </option>
              ))}
            </Select>
            <ListError query={workersQuery} />
            {errors.workerProfileId}
          </div>
        ) : null}
        {fields.projectAndSite ? (
          <>
            <div>
              <Label htmlFor={`${id}-project`}>{t("create.project")}</Label>
              <Select
                id={`${id}-project`}
                value={values.projectId}
                onChange={(event) => update({ projectId: event.target.value, siteId: "" })}
                disabled={projectsQuery.isPending}
              >
                <option value="">{projectsQuery.isPending ? t("create.listLoading") : t("create.allProjects")}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
              <ListError query={projectsQuery} />
            </div>
            <div>
              <Label htmlFor={`${id}-site`}>{t("create.site")}</Label>
              <Select
                id={`${id}-site`}
                value={values.siteId}
                onChange={(event) => update({ siteId: event.target.value })}
                disabled={values.projectId === "" || sitesQuery.isPending}
              >
                <option value="">{values.projectId === "" ? t("create.chooseProjectFirst") : t("create.allSites")}</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </Select>
              <ListError query={sitesQuery} />
            </div>
          </>
        ) : null}
        <div>
          <Label htmlFor={fieldId("fromDate")}>{t("create.from")}</Label>
          <Input
            id={fieldId("fromDate")}
            type="date"
            dir="ltr"
            className="text-start"
            value={values.fromDate}
            onChange={(event) => update({ fromDate: event.target.value })}
            {...a11y.fromDate}
          />
          {errors.fromDate}
        </div>
        <div>
          <Label htmlFor={fieldId("toDate")}>{t("create.to")}</Label>
          <Input
            id={fieldId("toDate")}
            type="date"
            dir="ltr"
            className="text-start"
            value={values.toDate}
            onChange={(event) => update({ toDate: event.target.value })}
            {...a11y.toDate}
          />
          {errors.toDate}
        </div>
      </>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("create.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form noValidate onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor={`${id}-type`}>{t("create.type")}</Label>
            <Select
              id={`${id}-type`}
              value={reportType}
              onChange={(event) => update({ reportType: event.target.value as ReportType })}
              aria-describedby={`${id}-type-help`}
            >
              {types.map((type) => (
                <option key={type} value={type}>
                  {enumLabel("ReportType", type)}
                </option>
              ))}
            </Select>
            <p id={`${id}-type-help`} className="mt-1 text-xs text-slate-500">
              {t(`create.typeHelp.${reportType}`)}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{filterFields}</div>

          <p role="note" className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {isOwner ? t("create.copyOwner") : t("create.copyManager")}
          </p>

          {create.isError ? (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage(create.error)}
            </p>
          ) : null}

          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? t("create.submitting") : t("create.submit")}
          </Button>
        </form>

        {currentId ? <CurrentReport key={currentId} reportId={currentId} onRetry={retry} retrying={create.isPending} /> : null}
      </CardContent>
    </Card>
  );
}
