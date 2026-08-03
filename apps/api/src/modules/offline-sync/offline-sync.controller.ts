import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { OfflineSyncService } from "./offline-sync.service";
import { OfflineSyncBatchDto } from "./dto/offline-sync-batch.dto";

@ApiBearerAuth()
@ApiTags("offline-sync")
@Controller("offline-sync")
export class OfflineSyncController {
  constructor(private readonly offlineSyncService: OfflineSyncService) {}

  @Post("batches")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @RequirePermissions(Permission.CLOCK_IN_OUT)
  submitBatch(
    @Body() dto: OfflineSyncBatchDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @CorrelationId() correlationId: string,
  ) {
    return this.offlineSyncService.submitBatch(user.organizationId, dto, user, idempotencyKey, correlationId);
  }

  @Get("batches")
  @RequirePermissions(Permission.VIEW_OWN_ATTENDANCE)
  listBatches(@CurrentUser() user: AuthenticatedUser) {
    return this.offlineSyncService.listBatches(user.organizationId, user);
  }

  @Get("batches/:id")
  @RequirePermissions(Permission.VIEW_OWN_ATTENDANCE)
  getBatch(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.offlineSyncService.getBatch(user.organizationId, id, user);
  }
}
