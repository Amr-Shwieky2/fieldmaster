import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  FINANCIAL_WORK_RULE_KEYS,
  PayrollPeriodStatus,
  WORK_RULE_KEYS,
  WORK_RULE_LIMITS,
  checkWorkRules,
  pickWorkRules,
  type WorkRuleKey,
  type WorkRuleVersion,
  type WorkRules,
} from "@fieldmaster/shared-types";
import { toBusinessDate, toBusinessYearMonth } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { canViewFinancials, hasPermission, Permission } from "../../common/auth/permissions";
import { toWorkRuleVersion, WorkRulesService } from "../../common/settings/work-rules.service";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import type { CreateWorkRuleVersionDto } from "./dto/work-rules.dto";

/** A version as a viewer may see it: the money rule only for a member who may see money. */
export type WorkRuleVersionView = Omit<WorkRuleVersion, "rules"> & { rules: Partial<WorkRules> };

export interface WorkRulesView {
  canEdit: boolean;
  /** Whether the viewer sees (and may change) the money rule. */
  canSeeMoney: boolean;
  /** The rules in force today. */
  current: Partial<WorkRules>;
  limits: Partial<Record<WorkRuleKey, { min: number; max: number }>>;
  /** Every version, oldest first (the first holds the starting values; a version with an effective date after today has not started yet). */
  versions: WorkRuleVersionView[];
  today: string;
}

export interface WorkRulesImpact {
  effectiveFrom: string;
  /** Months from the effective date on whose payroll is not finalized: their next calculation uses the new rules. */
  openMonths: { yearMonth: string; status: string; version: number | null }[];
  /** Finalized months from the effective date on: they keep their snapshot, whatever is added here. */
  finalizedMonths: { yearMonth: string; version: number }[];
}

/**
 * The organization's work rules as effective-dated versions (flexible
 * organization model). A change is a NEW version with an effective date
 * after today -- never an edit of an old one (a trigger refuses updates and
 * deletes) -- so what was already calculated is never rewritten: a
 * calculation uses the version in force on the business date it is about,
 * and a finalized payroll month keeps its own snapshot. Only the rules sent
 * change; the others keep the values in force on the effective date.
 */
@Injectable()
export class WorkRulesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workRules: WorkRulesService,
    private readonly auditService: AuditService,
  ) {}

  async view(organizationId: string, viewer: AuthenticatedUser): Promise<WorkRulesView> {
    const versions = await this.workRules.versions(organizationId);
    const seeMoney = canViewFinancials(viewer);
    const today = toBusinessDate(new Date());
    return {
      canEdit: hasPermission(viewer, Permission.MANAGE_ORG_SETTINGS),
      canSeeMoney: seeMoney,
      current: shown(pickWorkRules(versions, today), seeMoney),
      // The money rule's limits are money too: left out for a member who may not see it.
      limits: Object.fromEntries(Object.entries(WORK_RULE_LIMITS).filter(([key]) => seeMoney || !FINANCIAL_WORK_RULE_KEYS.includes(key as WorkRuleKey))) as WorkRulesView["limits"],
      versions: versions.map((version) => ({ ...version, rules: shown(version.rules, seeMoney) })),
      today,
    };
  }

  /** Which months a change effective on this date reaches (and which stay as they are). */
  async impact(organizationId: string, effectiveFromInput?: string): Promise<WorkRulesImpact> {
    const effectiveFrom = effectiveFromInput ?? toBusinessDate(new Date(Date.now() + 24 * 3_600_000));
    const firstMonth = effectiveFrom.slice(0, 7);
    const currentMonth = toBusinessYearMonth(new Date());
    const periods = await this.prisma.payrollPeriod.findMany({
      where: { organizationId, yearMonth: { gte: firstMonth } },
      orderBy: [{ yearMonth: "asc" }, { version: "desc" }],
      select: { yearMonth: true, version: true, status: true },
    });
    const latest = new Map<string, { version: number; status: string }>();
    for (const period of periods) if (!latest.has(period.yearMonth)) latest.set(period.yearMonth, { version: period.version, status: period.status });

    const openMonths: WorkRulesImpact["openMonths"] = [];
    const finalizedMonths: WorkRulesImpact["finalizedMonths"] = [];
    for (const [yearMonth, period] of latest) {
      if (period.status === PayrollPeriodStatus.FINALIZED) finalizedMonths.push({ yearMonth, version: period.version });
      else openMonths.push({ yearMonth, status: period.status, version: period.version });
    }
    // The current month is open even before anyone calculated it (when the change reaches it).
    if (firstMonth <= currentMonth && !latest.has(currentMonth)) openMonths.push({ yearMonth: currentMonth, status: "NOT_CALCULATED", version: null });
    openMonths.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
    return { effectiveFrom, openMonths, finalizedMonths };
  }

  async create(organizationId: string, dto: CreateWorkRuleVersionDto, actor: AuthenticatedUser, correlationId: string): Promise<WorkRulesView> {
    const today = toBusinessDate(new Date());
    if (!isRealDate(dto.effectiveFrom)) throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "effectiveFrom must be a real date.", { field: "effectiveFrom" });
    if (dto.effectiveFrom <= today) {
      throw new AppException(400, ErrorCodes.WORK_RULES_EFFECTIVE_DATE_PAST, "A change of the work rules must take effect after today.", { today });
    }
    const sent = WORK_RULE_KEYS.filter((key) => dto[key] !== undefined);
    if (sent.length === 0) throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "Send at least one rule to change.");
    // The money rule is for those who may see money.
    if (sent.some((key) => FINANCIAL_WORK_RULE_KEYS.includes(key)) && !canViewFinancials(actor)) {
      throw new AppException(403, ErrorCodes.FORBIDDEN, "Changing the penalty amount needs the permission to see financial amounts.");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`work_rules:${organizationId}`}, 0))`;
      const stored = await this.workRules.versions(organizationId, tx);
      const base = pickWorkRules(stored, dto.effectiveFrom);
      const merged: WorkRules = { ...base };
      for (const key of sent) merged[key] = dto[key] as number;

      const problems = checkWorkRules(merged);
      if (problems.length > 0) throw new AppException(400, ErrorCodes.WORK_RULES_INVALID, "The work rules are not valid.", { problems });
      const changed = WORK_RULE_KEYS.filter((key) => merged[key] !== base[key]);
      if (changed.length === 0) throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "Nothing changes: these are the rules already in force on that date.");

      // The first version (the starting values) always exists, so the history is whole.
      const nextVersion = Math.max(...stored.map((version) => version.version)) + 1;
      const created = await tx.workRuleVersion.create({ data: rowOf(organizationId, nextVersion, dto.effectiveFrom, merged, dto.reason, actor.sub) });
      for (const key of changed) {
        await this.auditService.record(
          {
            organizationId,
            actorUserId: actor.sub,
            action: "WORK_RULE_CHANGED",
            entityType: "WorkRuleVersion",
            entityId: created.id,
            field: `workRules.${key}`,
            oldValue: String(base[key]),
            newValue: String(merged[key]),
            reason: dto.reason,
            note: `version ${nextVersion}, from ${dto.effectiveFrom}`,
            correlationId,
          },
          tx,
        );
      }
    });
    return this.view(organizationId, actor);
  }
}

function shown(rules: WorkRules, seeMoney: boolean): Partial<WorkRules> {
  if (seeMoney) return { ...rules };
  const copy: Partial<WorkRules> = { ...rules };
  for (const key of FINANCIAL_WORK_RULE_KEYS) delete copy[key];
  return copy;
}

function rowOf(organizationId: string, version: number, effectiveFrom: string, rules: WorkRules, reason: string, createdBy: string | null): Prisma.WorkRuleVersionUncheckedCreateInput {
  return { id: generateId(), organizationId, version, effectiveFrom, reason, createdBy, ...rules };
}

/** "2026-02-30" matches the pattern but is not a day. */
function isRealDate(date: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

export { toWorkRuleVersion };
