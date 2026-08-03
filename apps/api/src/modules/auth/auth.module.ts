import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { OTP_PROVIDER } from "./otp-providers/otp-provider.token";
import { ConsoleOtpProvider } from "./otp-providers/console-otp.provider";
import { TwilioVerifyProvider } from "./otp-providers/twilio-verify.provider";

@Module({
  imports: [JwtModule.register({ global: true })],
  controllers: [AuthController],
  providers: [
    AuthService,
    ConsoleOtpProvider,
    TwilioVerifyProvider,
    {
      provide: OTP_PROVIDER,
      useFactory: (consoleProvider: ConsoleOtpProvider, twilioProvider: TwilioVerifyProvider) =>
        process.env.TWILIO_ACCOUNT_SID ? twilioProvider : consoleProvider,
      inject: [ConsoleOtpProvider, TwilioVerifyProvider],
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
