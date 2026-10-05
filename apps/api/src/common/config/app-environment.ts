/**
 * Deployment environment + development-login switch.
 *
 * APP_ENV (development | staging | production) says what kind of deployment
 * this is. It is separate from NODE_ENV, which only says how the code was
 * built: a staging deployment on Render runs with NODE_ENV=production but
 * APP_ENV=staging. When APP_ENV is unset it is derived from NODE_ENV
 * (production -> production, anything else -> development).
 *
 * DEV_LOGIN_ENABLED turns on the test login (fixed OTP code 123456 and the
 * one-click /auth/dev/* endpoints). It only takes effect in development or
 * staging; combining it with APP_ENV=production is a configuration error
 * and the API refuses to start.
 *
 * OTP_PROVIDER (console | twilio | dev-fixed) optionally pins the OTP
 * provider. When unset: dev login mode -> dev-fixed, otherwise Twilio when
 * TWILIO_ACCOUNT_SID is set, otherwise console. In dev login mode the
 * provider is always dev-fixed: the login screens promise that 123456 works,
 * so pinning console/twilio while dev login is on is a configuration error.
 */

export const APP_ENVIRONMENTS = ["development", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVIRONMENTS)[number];

export const OTP_PROVIDER_KINDS = ["console", "twilio", "dev-fixed"] as const;
export type OtpProviderKind = (typeof OTP_PROVIDER_KINDS)[number];

export interface AppEnvironment {
  appEnv: AppEnv;
  devLoginEnabled: boolean;
  otpProvider: OtpProviderKind;
}

/** Injection token for the resolved {@link AppEnvironment}. */
export const APP_ENVIRONMENT = Symbol("APP_ENVIRONMENT");

export class AppEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppEnvironmentError";
  }
}

function isAppEnv(value: string): value is AppEnv {
  return (APP_ENVIRONMENTS as readonly string[]).includes(value);
}

function isOtpProviderKind(value: string): value is OtpProviderKind {
  return (OTP_PROVIDER_KINDS as readonly string[]).includes(value);
}

function parseBoolean(name: string, raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new AppEnvironmentError(`${name} must be "true" or "false" (got "${raw}").`);
}

export function resolveAppEnvironment(env: NodeJS.ProcessEnv = process.env): AppEnvironment {
  const rawAppEnv = env.APP_ENV?.trim().toLowerCase();
  const appEnv = rawAppEnv ? rawAppEnv : env.NODE_ENV === "production" ? "production" : "development";
  if (!isAppEnv(appEnv)) {
    throw new AppEnvironmentError(`APP_ENV must be one of ${APP_ENVIRONMENTS.join(", ")} (got "${env.APP_ENV}").`);
  }

  const devLoginRequested = parseBoolean("DEV_LOGIN_ENABLED", env.DEV_LOGIN_ENABLED);
  if (devLoginRequested && appEnv === "production") {
    throw new AppEnvironmentError(
      "Refusing to start: DEV_LOGIN_ENABLED=true is not allowed when APP_ENV=production. " +
        "Dev login lets anyone sign in without SMS verification. Set DEV_LOGIN_ENABLED=false, " +
        "or use APP_ENV=staging for a test deployment.",
    );
  }
  const devLoginEnabled = devLoginRequested;

  const rawProvider = env.OTP_PROVIDER?.trim().toLowerCase();
  let otpProvider: OtpProviderKind;
  if (rawProvider) {
    if (!isOtpProviderKind(rawProvider)) {
      throw new AppEnvironmentError(`OTP_PROVIDER must be one of ${OTP_PROVIDER_KINDS.join(", ")} (got "${env.OTP_PROVIDER}").`);
    }
    if (devLoginEnabled && rawProvider !== "dev-fixed") {
      throw new AppEnvironmentError(
        `OTP_PROVIDER=${rawProvider} cannot be combined with DEV_LOGIN_ENABLED=true: in dev login mode every phone number ` +
          "must accept the fixed code 123456 (dev-fixed). Unset OTP_PROVIDER, or set DEV_LOGIN_ENABLED=false to test real OTP.",
      );
    }
    if (rawProvider === "dev-fixed" && !devLoginEnabled) {
      throw new AppEnvironmentError(
        "OTP_PROVIDER=dev-fixed requires dev login mode (DEV_LOGIN_ENABLED=true with APP_ENV=development or staging).",
      );
    }
    if (rawProvider === "twilio" && !(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID)) {
      throw new AppEnvironmentError(
        "OTP_PROVIDER=twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID.",
      );
    }
    otpProvider = rawProvider;
  } else if (devLoginEnabled) {
    otpProvider = "dev-fixed";
  } else {
    otpProvider = env.TWILIO_ACCOUNT_SID ? "twilio" : "console";
  }

  return { appEnv, devLoginEnabled, otpProvider };
}
