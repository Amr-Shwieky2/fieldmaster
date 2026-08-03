import { Injectable, Logger } from "@nestjs/common";
import type { OtpProvider, OtpRequestResult } from "./otp-provider.interface";

/**
 * Production adapter for Twilio Verify. Uses the REST API directly (no
 * `twilio` SDK dependency) via fetch with HTTP Basic auth. Twilio owns code
 * generation and comparison, so no OTP hash is ever stored locally for
 * phone numbers verified through this provider.
 *
 * This has not been exercised against a live Twilio account in this
 * environment (no credentials available) -- see IMPLEMENTATION_STATUS.md.
 */
@Injectable()
export class TwilioVerifyProvider implements OtpProvider {
  readonly name = "TWILIO" as const;
  private readonly logger = new Logger("TwilioVerify");

  private get accountSid() {
    return process.env.TWILIO_ACCOUNT_SID!;
  }
  private get authToken() {
    return process.env.TWILIO_AUTH_TOKEN!;
  }
  private get serviceSid() {
    return process.env.TWILIO_VERIFY_SERVICE_SID!;
  }

  private authHeader(): string {
    return "Basic " + Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");
  }

  async request(phoneNumber: string): Promise<OtpRequestResult> {
    const url = `https://verify.twilio.com/v2/Services/${this.serviceSid}/Verifications`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: phoneNumber, Channel: "sms" }),
    });
    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Twilio Verify request failed: ${response.status} ${body}`);
      throw new Error("Failed to send verification code.");
    }
    const json = (await response.json()) as { sid: string };
    return { providerRef: json.sid };
  }

  async verify(phoneNumber: string, code: string): Promise<boolean> {
    const url = `https://verify.twilio.com/v2/Services/${this.serviceSid}/VerificationCheck`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: phoneNumber, Code: code }),
    });
    if (!response.ok) return false;
    const json = (await response.json()) as { status: string };
    return json.status === "approved";
  }
}
