import { Global, Module } from "@nestjs/common";
import { APP_ENVIRONMENT, resolveAppEnvironment } from "./app-environment";

/**
 * Resolves APP_ENV / DEV_LOGIN_ENABLED / OTP_PROVIDER once at startup. The
 * factory throws on an invalid or unsafe combination, so the application
 * (or a test app built from AppModule) fails to initialise instead of
 * running with dev login exposed in production.
 */
@Global()
@Module({
  providers: [{ provide: APP_ENVIRONMENT, useFactory: () => resolveAppEnvironment() }],
  exports: [APP_ENVIRONMENT],
})
export class AppConfigModule {}
