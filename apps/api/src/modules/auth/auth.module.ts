import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { DevAuthController } from "./dev-auth.controller";
import { DevLoginEnabledGuard } from "./dev-login-enabled.guard";
import { OTP_PROVIDER } from "./otp-providers/otp-provider.token";
import { ConsoleOtpProvider } from "./otp-providers/console-otp.provider";
import { TwilioVerifyProvider } from "./otp-providers/twilio-verify.provider";
import { DevFixedCodeOtpProvider } from "./otp-providers/dev-fixed-code-otp.provider";
import { APP_ENVIRONMENT, type AppEnvironment } from "../../common/config/app-environment";

@Module({
  imports: [JwtModule.register({ global: true })],
  controllers: [AuthController, DevAuthController],
  providers: [
    AuthService,
    DevLoginEnabledGuard,
    ConsoleOtpProvider,
    TwilioVerifyProvider,
    DevFixedCodeOtpProvider,
    {
      provide: OTP_PROVIDER,
      useFactory: (
        appEnvironment: AppEnvironment,
        consoleProvider: ConsoleOtpProvider,
        twilioProvider: TwilioVerifyProvider,
        devFixedProvider: DevFixedCodeOtpProvider,
      ) => {
        switch (appEnvironment.otpProvider) {
          case "twilio":
            return twilioProvider;
          case "dev-fixed":
            return devFixedProvider;
          default:
            return consoleProvider;
        }
      },
      inject: [APP_ENVIRONMENT, ConsoleOtpProvider, TwilioVerifyProvider, DevFixedCodeOtpProvider],
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
