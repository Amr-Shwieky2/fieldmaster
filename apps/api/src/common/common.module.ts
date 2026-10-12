import { Global, Module } from "@nestjs/common";
import { EncryptionService } from "./encryption/encryption.service";
import { AuditService } from "./audit/audit.service";
import { IdempotencyService } from "./idempotency/idempotency.service";
import { FilesService } from "./files/files.service";
import { OrganizationSettingsService } from "./settings/organization-settings.service";

@Global()
@Module({
  providers: [EncryptionService, AuditService, IdempotencyService, FilesService, OrganizationSettingsService],
  exports: [EncryptionService, AuditService, IdempotencyService, FilesService, OrganizationSettingsService],
})
export class CommonModule {}
