import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { generateId } from "../ids";
import { AppException, ErrorCodes } from "../errors/app-exception";

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs `handler` at most once per (key, route). A retry with the same key
   * and request body replays the stored response. A retry with the same key
   * but a *different* body is rejected as a conflict (spec section 28.3).
   */
  async withIdempotency<T>(
    key: string | undefined,
    route: string,
    requestBody: unknown,
    handler: () => Promise<{ status: number; body: T }>,
  ): Promise<{ status: number; body: T }> {
    if (!key) {
      throw new AppException(400, ErrorCodes.IDEMPOTENCY_KEY_REQUIRED, "An Idempotency-Key header is required for this operation.");
    }

    const requestHash = createHash("sha256").update(JSON.stringify(requestBody ?? {})).digest("hex");

    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { key_route: { key, route } },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new AppException(
          409,
          ErrorCodes.IDEMPOTENCY_KEY_CONFLICT,
          "This Idempotency-Key was already used with a different request body.",
        );
      }
      if (existing.responseStatus !== null && existing.responseBodyJson !== null) {
        return { status: existing.responseStatus, body: existing.responseBodyJson as T };
      }
    } else {
      await this.prisma.idempotencyRecord.create({
        data: { id: generateId(), key, route, requestHash },
      });
    }

    const result = await handler();

    await this.prisma.idempotencyRecord.update({
      where: { key_route: { key, route } },
      data: { responseStatus: result.status, responseBodyJson: result.body as object },
    });

    return result;
  }
}
