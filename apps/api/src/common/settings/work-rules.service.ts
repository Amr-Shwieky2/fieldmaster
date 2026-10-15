import { Injectable } from "@nestjs/common";
import type { Prisma, WorkRuleVersion as WorkRuleVersionRow } from "@prisma/client";
import {
  DEFAULT_WORK_RULES,
  WORK_RULES_FIRST_EFFECTIVE_DATE,
  pickWorkRules,
  type WorkRuleVersion,
  type WorkRules,
} from "@fieldmaster/shared-types";
import { toBusinessDate } from "@fieldmaster/shared-validation";
import { PrismaService } from "../prisma/prisma.service";

type Client = Pick<PrismaService, "workRuleVersion"> | Pick<Prisma.TransactionClient, "workRuleVersion">;

export function rulesOf(row: WorkRuleVersionRow): WorkRules {
  return {
    standardDayMinutes: row.standardDayMinutes,
    overtimeThresholdMinutes: row.overtimeThresholdMinutes,
    freeForgottenStampsPerMonth: row.freeForgottenStampsPerMonth,
    forgottenStampPenaltyAgorot: row.forgottenStampPenaltyAgorot,
    emergencyMinutesBefore: row.emergencyMinutesBefore,
    emergencyMinutesAfter: row.emergencyMinutesAfter,
    clockInEarlyWindowMinutes: row.clockInEarlyWindowMinutes,
  };
}

export function toWorkRuleVersion(row: WorkRuleVersionRow): WorkRuleVersion {
  return {
    id: row.id,
    version: row.version,
    effectiveFrom: row.effectiveFrom,
    rules: rulesOf(row),
    reason: row.reason,
    createdByUserId: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The version that stands for "no version stored yet": the defaults, in force since the beginning. */
export function baselineVersion(): WorkRuleVersion {
  return { id: "baseline", version: 0, effectiveFrom: WORK_RULES_FIRST_EFFECTIVE_DATE, rules: { ...DEFAULT_WORK_RULES }, reason: null, createdByUserId: null, createdAt: new Date(0).toISOString() };
}

/** An organization's rule versions, loaded once: ask it for the rules of any number of business dates. */
export class WorkRulesResolver {
  constructor(readonly versions: readonly WorkRuleVersion[]) {}

  /** The rules in force on a business date (YYYY-MM-DD). */
  rulesFor = (businessDate: string): WorkRules => pickWorkRules(this.versions, businessDate);

  /** The rules in force today (Asia/Jerusalem). */
  current = (now: Date = new Date()): WorkRules => this.rulesFor(toBusinessDate(now));
}

/**
 * The organization's work rules, read from the database whenever a
 * calculation needs them (never cached across requests: a new version
 * applies at once). An organization with no stored version uses the default
 * rules, which are the numbers the system used before they were settings, so
 * nothing is written until an Owner changes one.
 */
@Injectable()
export class WorkRulesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every stored version, oldest first by effective date then creation. */
  async versions(organizationId: string, client: Client = this.prisma): Promise<WorkRuleVersion[]> {
    const rows = await client.workRuleVersion.findMany({ where: { organizationId }, orderBy: [{ effectiveFrom: "asc" }, { version: "asc" }] });
    return rows.map(toWorkRuleVersion);
  }

  /** A resolver for any number of dates, from one query. */
  async resolver(organizationId: string, client: Client = this.prisma): Promise<WorkRulesResolver> {
    return new WorkRulesResolver(await this.versions(organizationId, client));
  }

  /** The rules in force on one business date. */
  async rulesOn(organizationId: string, businessDate: string, client: Client = this.prisma): Promise<WorkRules> {
    return (await this.resolver(organizationId, client)).rulesFor(businessDate);
  }

  /** The rules in force today. */
  async current(organizationId: string, client: Client = this.prisma): Promise<WorkRules> {
    return (await this.resolver(organizationId, client)).current();
  }
}
