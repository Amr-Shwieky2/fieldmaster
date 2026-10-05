/**
 * How a session was started. Recorded on the refresh-token family (`origin`)
 * and in every access token (`loginMethod` claim) so that sessions created
 * through the test login stop working the moment dev login mode is turned
 * off -- flipping DEV_LOGIN_ENABLED to false must not leave anyone who used
 * the test login signed in.
 */
export const LoginMethod = {
  /** Real OTP (console or Twilio provider). */
  OTP: "OTP",
  /** One-click POST /auth/dev/login. */
  DEV_LOGIN: "DEV_LOGIN",
  /** OTP verified with the fixed test code (DevFixedCodeOtpProvider). */
  DEV_FIXED_OTP: "DEV_FIXED_OTP",
} as const;
export type LoginMethod = (typeof LoginMethod)[keyof typeof LoginMethod];

export function isTestModeLoginMethod(method: string | null | undefined): boolean {
  return method === LoginMethod.DEV_LOGIN || method === LoginMethod.DEV_FIXED_OTP;
}

/** Message shared by every place that rejects a test-mode session after dev login was turned off. */
export const TEST_MODE_SESSION_ENDED_MESSAGE = "This test-mode session ended because dev login is disabled. Please sign in again.";
