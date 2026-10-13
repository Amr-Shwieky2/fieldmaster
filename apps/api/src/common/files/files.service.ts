import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Options of a signed download URL. */
export interface SignedUrlOptions {
  /** Seconds the URL stays valid (default 300). */
  expiresInSeconds?: number;
  /** Suggested file name: the URL answers with `Content-Disposition: attachment` and this name. */
  downloadFileName?: string;
  /** Serve inline (e.g. an identity image shown in the review page) instead of as an attachment. */
  inline?: boolean;
  /** Content type the URL answers with. */
  contentType?: string;
}

/**
 * Private object storage. Points at the MinIO container in development
 * (S3_ENDPOINT set) and at real AWS S3 in production (S3_ENDPOINT unset,
 * default AWS endpoint resolution + IAM credentials). Same client either
 * way since MinIO speaks the S3 protocol -- see technical-decisions.md.
 * Nothing is public: objects are only reachable through short-lived signed
 * URLs or read back by the API.
 */
@Injectable()
export class FilesService implements OnModuleInit {
  private readonly logger = new Logger(FilesService.name);
  private readonly bucket = process.env.S3_BUCKET ?? "fieldmaster-dev";
  private readonly client = new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
        : undefined,
  });

  async onModuleInit() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created object storage bucket "${this.bucket}".`);
      } catch (error) {
        this.logger.warn(`Could not verify or create bucket "${this.bucket}": ${(error as Error).message}`);
      }
    }
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  /** The object's bytes, or null when it does not exist. */
  async getObject(key: string): Promise<Buffer | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!result.Body) return null;
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === "NoSuchKey" || name === "NotFound") return null;
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** A short-lived signed GET URL (Step 8: optionally with a download file name or served inline). */
  async getSignedDownloadUrl(key: string, options: number | SignedUrlOptions = 300): Promise<string> {
    const { expiresInSeconds = 300, downloadFileName, inline, contentType } = typeof options === "number" ? { expiresInSeconds: options } : options;
    const disposition = downloadFileName
      ? `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(downloadFileName)}`
      : inline
        ? "inline"
        : undefined;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(disposition ? { ResponseContentDisposition: disposition } : {}),
      ...(contentType ? { ResponseContentType: contentType } : {}),
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}
