import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { AppException } from "../errors/app-exception";

interface RequestWithCorrelation extends Request {
  correlationId?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("ExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithCorrelation>();
    const correlationId = request.correlationId ?? "unknown";

    if (exception instanceof AppException) {
      const body = exception.getResponse() as { code: string; message: string; details?: unknown };
      response.status(exception.getStatus()).json({
        statusCode: exception.getStatus(),
        code: body.code,
        message: body.message,
        details: body.details ?? {},
        correlationId,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const nestBody = exception.getResponse();
      const message =
        typeof nestBody === "string"
          ? nestBody
          : Array.isArray((nestBody as { message?: unknown }).message)
            ? ((nestBody as { message: string[] }).message.join("; "))
            : ((nestBody as { message?: string }).message ?? exception.message);

      response.status(status).json({
        statusCode: status,
        code: status === HttpStatus.UNAUTHORIZED ? "UNAUTHENTICATED" : status === HttpStatus.FORBIDDEN ? "FORBIDDEN" : status === HttpStatus.NOT_FOUND ? "NOT_FOUND" : status === HttpStatus.BAD_REQUEST ? "VALIDATION_FAILED" : "ERROR",
        message,
        details: {},
        correlationId,
      });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : exception, correlationId);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      details: {},
      correlationId,
    });
  }
}
