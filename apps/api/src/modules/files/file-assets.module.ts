import { Module } from "@nestjs/common";
import { FileAssetsController } from "./file-assets.controller";
import { FileAssetsService } from "./file-assets.service";
import { UploadsService } from "./uploads.service";
import { MALWARE_SCANNER, NoopMalwareScanner } from "./malware-scanner";

/**
 * Uploaded files (Step 8): upload validation, metadata stripping and the
 * malware-scan hook (UploadsService, used by the public onboarding routes and,
 * since Step 9, by the mobile app's attachments), and the Owner's audited view
 * URLs (`GET /file-assets/:id/view-url`).
 */
@Module({
  controllers: [FileAssetsController],
  providers: [UploadsService, FileAssetsService, { provide: MALWARE_SCANNER, useClass: NoopMalwareScanner }],
  exports: [UploadsService],
})
export class FileAssetsModule {}
