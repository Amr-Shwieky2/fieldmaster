import { Global, Module } from "@nestjs/common";
import { EncryptionService } from "./encryption/encryption.service";
import { AuditService } from "./audit/audit.service";
import { IdempotencyService } from "./idempotency/idempotency.service";
import { FilesService } from "./files/files.service";
import { OrganizationSettingsService } from "./settings/organization-settings.service";
import { WorkRulesService } from "./settings/work-rules.service";

@Global()
@Module({
  providers: [EncryptionService, AuditService, IdempotencyService, FilesService, OrganizationSettingsService, WorkRulesService],
  exports: [EncryptionService, AuditService, IdempotencyService, FilesService, OrganizationSettingsService, WorkRulesService],
})
export class CommonModule {}
