import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { generateId } from "../../common/ids";

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(organizationId: string) {
    const existing = await this.prisma.organizationSettings.findUnique({ where: { organizationId } });
    if (existing) return existing;
    return this.prisma.organizationSettings.create({ data: { id: generateId(), organizationId } });
  }

  async updateSettings(
    organizationId: string,
    patch: Partial<{
      autoDeductUnpaidBreaks: boolean;
      defaultLanguage: string;
      onboardingInvitationTtlHours: number;
    }>,
  ) {
    await this.getSettings(organizationId);
    return this.prisma.organizationSettings.update({ where: { organizationId }, data: patch });
  }
}
