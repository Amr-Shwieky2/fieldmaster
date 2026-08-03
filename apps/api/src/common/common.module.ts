import { Global, Module } from "@nestjs/common";
import { EncryptionService } from "./encryption/encryption.service";
import { AuditService } from "./audit/audit.service";
import { IdempotencyService } from "./idempotency/idempotency.service";
import { FilesService } from "./files/files.service";

@Global()
@Module({
  providers: [EncryptionService, AuditService, IdempotencyService, FilesService],
  exports: [EncryptionService, AuditService, IdempotencyService, FilesService],
})
export class CommonModule {}
