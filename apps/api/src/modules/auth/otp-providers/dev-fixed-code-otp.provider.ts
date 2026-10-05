import { Injectable, Logger } from "@nestjs/common";
import type { OtpProvider, OtpRequestResult } from "./otp-provider.interface";
import { maskPhone } from "./console-otp.provider";

/** The code every phone number accepts while dev login mode is on. */
export const DEV_FIXED_OTP_CODE = "123456";

/**
 * Dev-login adapter: no SMS and no console scraping -- every phone number
 * gets the same fixed code. Only selectable while dev login mode is enabled
 * (APP_ENV development/staging + DEV_LOGIN_ENABLED=true); AuthService also
 * refuses to accept challenges issued by this provider once dev login mode
 * is off, so a leftover challenge cannot be redeemed with 123456 later.
 */
@Injectable()
export class DevFixedCodeOtpProvider implements OtpProvider {
  readonly name = "DEV_FIXED" as const;
  private readonly logger = new Logger("OTP");

  async request(phoneNumber: string): Promise<OtpRequestResult> {
    this.logger.log(`[DEV LOGIN] Fixed test code issued for ${maskPhone(phoneNumber)} (no SMS sent)`);
    return { providerRef: null, devCode: DEV_FIXED_OTP_CODE };
  }

  async verify(): Promise<boolean> {
    // Verified locally against the stored hash, like the console provider.
    return false;
  }
}
