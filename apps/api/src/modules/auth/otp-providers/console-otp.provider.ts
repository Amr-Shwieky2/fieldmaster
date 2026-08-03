import { Injectable, Logger } from "@nestjs/common";
import { randomInt } from "node:crypto";
import type { OtpProvider, OtpRequestResult } from "./otp-provider.interface";

/** Development adapter: prints the OTP to the API log instead of sending a real SMS. */
@Injectable()
export class ConsoleOtpProvider implements OtpProvider {
  readonly name = "CONSOLE" as const;
  private readonly logger = new Logger("OTP");

  async request(phoneNumber: string): Promise<OtpRequestResult> {
    // Test-only escape hatch: a fixed code lets e2e tests authenticate
    // deterministically without scraping log output. Never set in
    // production/development environments.
    const code = process.env.FIELDMASTER_TEST_OTP ?? String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.logger.warn(`[DEV] OTP for ${maskPhone(phoneNumber)}: ${code}`);
    return { providerRef: null, devCode: code };
  }

  async verify(): Promise<boolean> {
    // Verification for the console provider is handled by OtpService via
    // the locally hashed code -- this method is never invoked for CONSOLE.
    return false;
  }
}

export function maskPhone(phoneNumber: string): string {
  if (phoneNumber.length <= 4) return "***";
  return `${phoneNumber.slice(0, -4).replace(/./g, "*")}${phoneNumber.slice(-4)}`;
}
