import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { AppEnvironmentError, resolveAppEnvironment } from "./common/config/app-environment";

async function bootstrap() {
  // Validate APP_ENV / DEV_LOGIN_ENABLED / OTP_PROVIDER before anything else
  // (importing AppModule above has already loaded apps/api/.env). An unsafe
  // combination such as APP_ENV=production + DEV_LOGIN_ENABLED=true stops the
  // process here with a clear message instead of starting a server.
  let environment;
  try {
    environment = resolveAppEnvironment();
  } catch (error) {
    if (error instanceof AppEnvironmentError) {
      console.error(`FieldMaster API configuration error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.use(helmet());
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? "").split(",").filter(Boolean),
    credentials: true,
  });

  const apiPrefix = process.env.API_PREFIX ?? "api/v1";
  app.setGlobalPrefix(apiPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle("FieldMaster API")
    .setDescription("Workforce management platform for field construction, traffic-control, and Ramzanim crews.")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`FieldMaster API listening on port ${port} (prefix: /${apiPrefix}, APP_ENV=${environment.appEnv}, OTP provider: ${environment.otpProvider})`);
  if (environment.devLoginEnabled) {
    console.warn(
      "TEST MODE: dev login is ENABLED -- every phone number accepts code 123456 and /api/v1/auth/dev/* allows one-click login without SMS. Never enable this on a deployment with real data.",
    );
  }
}

bootstrap();
