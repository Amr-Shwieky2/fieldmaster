import { AppEnvironmentError, resolveAppEnvironment } from "../app-environment";

describe("resolveAppEnvironment", () => {
  it("defaults to development with dev login off when nothing is set", () => {
    expect(resolveAppEnvironment({})).toEqual({ appEnv: "development", devLoginEnabled: false, otpProvider: "console" });
  });

  it("derives APP_ENV=production from NODE_ENV=production when APP_ENV is unset", () => {
    expect(resolveAppEnvironment({ NODE_ENV: "production" }).appEnv).toBe("production");
  });

  it("lets APP_ENV=staging override NODE_ENV=production (a staging deploy runs a production build)", () => {
    expect(resolveAppEnvironment({ NODE_ENV: "production", APP_ENV: "staging" }).appEnv).toBe("staging");
  });

  it.each(["development", "staging"])("enables dev login and the fixed-code OTP provider for APP_ENV=%s", (appEnv) => {
    expect(resolveAppEnvironment({ APP_ENV: appEnv, DEV_LOGIN_ENABLED: "true" })).toEqual({
      appEnv,
      devLoginEnabled: true,
      otpProvider: "dev-fixed",
    });
  });

  it("refuses APP_ENV=production with DEV_LOGIN_ENABLED=true", () => {
    expect(() => resolveAppEnvironment({ APP_ENV: "production", DEV_LOGIN_ENABLED: "true" })).toThrow(AppEnvironmentError);
    expect(() => resolveAppEnvironment({ APP_ENV: "production", DEV_LOGIN_ENABLED: "true" })).toThrow(
      /DEV_LOGIN_ENABLED=true is not allowed when APP_ENV=production/,
    );
  });

  it("also refuses it when production is only implied by NODE_ENV=production", () => {
    expect(() => resolveAppEnvironment({ NODE_ENV: "production", DEV_LOGIN_ENABLED: "true" })).toThrow(AppEnvironmentError);
  });

  it("accepts APP_ENV=production with dev login explicitly off", () => {
    expect(resolveAppEnvironment({ APP_ENV: "production", DEV_LOGIN_ENABLED: "false" }).devLoginEnabled).toBe(false);
  });

  it("rejects unknown APP_ENV and non-boolean DEV_LOGIN_ENABLED values", () => {
    expect(() => resolveAppEnvironment({ APP_ENV: "prod" })).toThrow(/APP_ENV must be one of/);
    expect(() => resolveAppEnvironment({ DEV_LOGIN_ENABLED: "yes" })).toThrow(/DEV_LOGIN_ENABLED must be "true" or "false"/);
  });

  it("keeps the existing provider auto-selection when dev login is off", () => {
    expect(resolveAppEnvironment({ TWILIO_ACCOUNT_SID: "AC123" }).otpProvider).toBe("twilio");
    expect(resolveAppEnvironment({}).otpProvider).toBe("console");
  });

  it("lets OTP_PROVIDER pin a provider when dev login is off, and only dev-fixed when it is on", () => {
    expect(resolveAppEnvironment({ OTP_PROVIDER: "console", TWILIO_ACCOUNT_SID: "AC123" }).otpProvider).toBe("console");
    expect(resolveAppEnvironment({ OTP_PROVIDER: "dev-fixed", APP_ENV: "staging", DEV_LOGIN_ENABLED: "true" }).otpProvider).toBe("dev-fixed");
    // The login screens promise 123456 in dev login mode, so a real provider there is refused.
    expect(() => resolveAppEnvironment({ OTP_PROVIDER: "console", APP_ENV: "development", DEV_LOGIN_ENABLED: "true" })).toThrow(
      /cannot be combined with DEV_LOGIN_ENABLED=true/,
    );
    expect(() =>
      resolveAppEnvironment({ OTP_PROVIDER: "twilio", APP_ENV: "staging", DEV_LOGIN_ENABLED: "true", TWILIO_ACCOUNT_SID: "a", TWILIO_AUTH_TOKEN: "b", TWILIO_VERIFY_SERVICE_SID: "c" }),
    ).toThrow(/cannot be combined with DEV_LOGIN_ENABLED=true/);
    expect(() => resolveAppEnvironment({ OTP_PROVIDER: "dev-fixed" })).toThrow(/requires dev login mode/);
    expect(() => resolveAppEnvironment({ OTP_PROVIDER: "twilio" })).toThrow(/requires TWILIO_ACCOUNT_SID/);
    expect(() => resolveAppEnvironment({ OTP_PROVIDER: "sms" })).toThrow(/OTP_PROVIDER must be one of/);
  });
});
