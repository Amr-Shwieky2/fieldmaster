export interface OtpRequestResult {
  /** Opaque reference the provider needs at verification time (e.g. Twilio SID). Null for local providers. */
  providerRef: string | null;
  /** Only ever populated by the local/dev provider; never set for a real SMS provider. */
  devCode?: string;
}

export interface OtpProvider {
  readonly name: "CONSOLE" | "TWILIO" | "DEV_FIXED";
  request(phoneNumber: string): Promise<OtpRequestResult>;
  verify(phoneNumber: string, code: string, providerRef: string | null): Promise<boolean>;
}
