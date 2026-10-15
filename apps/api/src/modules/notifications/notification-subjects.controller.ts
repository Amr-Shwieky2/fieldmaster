import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { NotificationSubjectsService } from "./notification-subjects.service";

export class HandleNotificationSubjectDto {
  @ApiPropertyOptional({ description: "What was done (e.g. «تم الاتصال بالعامل»)." })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/**
 * Mobile manager mode: the subject several notifications share. Readable by
 * a member who may open the screen where it is settled, within their
 * projects (otherwise 404, like an unknown id).
 */
@ApiBearerAuth()
@ApiTags("notifications")
@Controller("notification-subjects")
export class NotificationSubjectsController {
  constructor(private readonly subjects: NotificationSubjectsService) {}

  @Get(":id")
  get(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.subjects.get(user.organizationId, id, user);
  }

  /** Settles an entry the manager followed up or a worker's offline records reviewed (audited). */
  @Post(":id/handle")
  @HttpCode(HttpStatus.OK)
  handle(@Param("id") id: string, @Body() dto: HandleNotificationSubjectDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.subjects.handle(user.organizationId, id, user, dto.note, correlationId);
  }
}
