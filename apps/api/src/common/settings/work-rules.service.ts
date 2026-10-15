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
import { generateId } from "../ids";

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

/** Why the first version exists: the values the organization started with. */
export const FIRST_VERSION_REASON = "القيم الأصلية";

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
 * applies at once). Every organization has stored versions: the first one
 * (effective 2000-01-01, the starting values) was written by the migration
 * for the organizations that existed, and is written here for a new one the
 * first time its rules are read. That is the only use of DEFAULT_WORK_RULES:
 * nothing is ever priced with default values.
 */
@Injectable()
export class WorkRulesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every stored version, oldest first by effective date then creation (the first version is created when missing). */
  async versions(organizationId: string, client: Client = this.prisma): Promise<WorkRuleVersion[]> {
    const read = () => client.workRuleVersion.findMany({ where: { organizationId }, orderBy: [{ effectiveFrom: "asc" }, { version: "asc" }] });
    let rows = await read();
    if (rows.length === 0) {
      await this.seedFirstVersion(organizationId, client);
      rows = await read();
    }
    return rows.map(toWorkRuleVersion);
  }

  /**
   * Writes an organization's first version (version 1, effective 2000-01-01,
   * the starting values) unless it has one; concurrent callers write it once.
   */
  async seedFirstVersion(organizationId: string, client: Client = this.prisma): Promise<void> {
    await client.workRuleVersion.createMany({
      data: [
        {
          id: generateId(),
          organizationId,
          version: 1,
          effectiveFrom: WORK_RULES_FIRST_EFFECTIVE_DATE,
          reason: FIRST_VERSION_REASON,
          createdBy: null,
          ...DEFAULT_WORK_RULES,
        },
      ],
      skipDuplicates: true,
    });
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
