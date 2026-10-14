import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { AuthenticatedRequest } from "../../common/auth/auth-context";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UploadsService } from "../files/uploads.service";

/**
 * Runs before multer reads the body of `POST /attachments`, so a caller who
 * may not upload never gets a file buffered: only a time-trackable member
 * with a worker profile (403 otherwise), below the limit of unattached files
 * (429 RATE_LIMITED). The upload checks the limit again before storing.
 */
@Injectable()
export class AttachmentUploadGuard implements CanActivate {
  constructor(private readonly uploads: UploadsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user?.workerProfileId) {
      throw new AppException(403, ErrorCodes.FORBIDDEN, "Only time-trackable members with a worker profile can upload attachments.");
    }
    await this.uploads.assertAttachmentQuota(user.workerProfileId);
    return true;
  }
}
