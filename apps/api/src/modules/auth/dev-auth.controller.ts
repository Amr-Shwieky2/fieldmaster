import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { AuthService } from "./auth.service";
import { DevLoginEnabledGuard } from "./dev-login-enabled.guard";
import { DevLoginDto } from "./dto/dev-login.dto";

/**
 * Test-mode login (DEV_LOGIN_ENABLED=true with APP_ENV development/staging).
 * Every route returns 404 when dev login mode is off.
 */
@ApiTags("auth (dev login - test mode only)")
@Public()
@UseGuards(DevLoginEnabledGuard)
@Controller("auth/dev")
export class DevAuthController {
  constructor(private readonly authService: AuthService) {}

  @Get("users")
  @ApiOperation({ summary: "List active members that can be signed in with one click (test mode only)." })
  listUsers() {
    return this.authService.listDevLoginUsers();
  }

  @Post("login")
  @ApiOperation({ summary: "Sign in as a member without SMS; returns the same session payload as /auth/otp/verify (test mode only)." })
  login(@Body() dto: DevLoginDto, @CorrelationId() correlationId: string) {
    return this.authService.devLogin(dto, correlationId);
  }
}
