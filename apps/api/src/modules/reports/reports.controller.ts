import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { IdempotencyService } from "../../common/idempotency/idempotency.service";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { ReportsService } from "./reports.service";
import { GenerateWorkerLedgerDto } from "./dto/generate-report.dto";

@ApiBearerAuth()
@ApiTags("reports")
@Controller("reports")
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  @Post("worker-attendance-ledger")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  async generateWorkerLedger(
    @Body() dto: GenerateWorkerLedgerDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.idempotencyService.withIdempotency(idempotencyKey, "generate-worker-ledger", dto, async () => {
      const body = await this.reportsService.generateWorkerAttendanceLedger(user.organizationId, dto, user, correlationId);
      return { status: 201, body };
    });
    return result.body;
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.listForOrganization(user.organizationId, user);
  }

  @Get(":id/download")
  async getDownloadUrl(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.getDownloadUrl(user.organizationId, id, user);
  }
}
