import { CallHandler, ExecutionContext, Injectable, NestInterceptor, PayloadTooLargeException } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Observable } from "rxjs";
import { MAX_UPLOAD_BYTES } from "@fieldmaster/shared-types";
import { fileTooLarge } from "./upload-errors";

/**
 * multer for one file in the multipart field `file`, with multer's memory
 * storage (no `storage` or `dest` option): the file is only held in memory
 * for validation and never written to the API's disk. The size limit is one
 * byte above the maximum, so multer stops reading a larger body early while
 * UploadsService does the exact check (at most MAX_UPLOAD_BYTES).
 */
const MulterSingleFile = FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES + 1, files: 1, fields: 4, parts: 5 } });

/** The multer interceptor, with its "file too large" error answered as 413 FILE_TOO_LARGE like the exact check. */
@Injectable()
export class SingleUploadInterceptor implements NestInterceptor {
  private readonly multer: NestInterceptor = new MulterSingleFile();

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      return await this.multer.intercept(context, next);
    } catch (error) {
      throw error instanceof PayloadTooLargeException ? fileTooLarge() : error;
    }
  }
}
