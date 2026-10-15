import { Body, Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { Public } from "../../common/decorators/public.decorator";
import { AuthService } from "./auth.service";
import { RequestOtpDto } from "./dto/request-otp.dto";
import { VerifyOtpDto } from "./dto/verify-otp.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** The caller's role, effective permissions and project scope (any signed-in member). */
  @ApiBearerAuth()
  @Get("me")
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user);
  }

  @Public()
  @Post("otp/request")
  @HttpCode(HttpStatus.NO_CONTENT)
  async requestOtp(@Body() dto: RequestOtpDto): Promise<void> {
    await this.authService.requestOtp(dto.phoneNumber);
  }

  @Public()
  @Post("otp/verify")
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Public()
  @Post("refresh")
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }
}
