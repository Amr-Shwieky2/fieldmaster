import { Body, Controller, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { DevicesService } from "./devices.service";
import { RegisterDevicePublicKeyDto } from "./dto/register-device-public-key.dto";
import { RegisterDeviceDto } from "./dto/register-device.dto";

@ApiBearerAuth()
@ApiTags("devices")
@Controller("devices")
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  /** Step 9: the signed-in device registers itself (platform, versions, push token); any signed-in member. */
  @Put("me")
  registerMyDevice(@Body() dto: RegisterDeviceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.devicesService.registerDevice(user, dto);
  }

  @Post("public-key")
  @RequirePermissions(Permission.CLOCK_IN_OUT)
  register(@Body() dto: RegisterDevicePublicKeyDto, @CurrentUser() user: AuthenticatedUser, @CorrelationId() correlationId: string) {
    return this.devicesService.registerPublicKey(user.organizationId, dto, user, correlationId);
  }

  @Post(":userId/:deviceId/revoke-key")
  @RequirePermissions(Permission.MANAGE_ORG_USERS)
  revoke(
    @Param("userId") userId: string,
    @Param("deviceId") deviceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.devicesService.revokePublicKey(user.organizationId, deviceId, userId, user, correlationId);
  }
}
