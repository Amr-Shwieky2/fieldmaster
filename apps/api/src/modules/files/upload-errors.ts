import { MAX_UPLOAD_BYTES, UPLOAD_CONTENT_TYPES, type FileAssetPurpose } from "@fieldmaster/shared-types";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";

export function fileTooLarge(): AppException {
  return new AppException(413, ErrorCodes.FILE_TOO_LARGE, "The file is larger than the upload limit.", { maxBytes: MAX_UPLOAD_BYTES });
}

export function fileTypeNotAllowed(purpose: FileAssetPurpose): AppException {
  return new AppException(415, ErrorCodes.FILE_TYPE_NOT_ALLOWED, "This type of file is not accepted here.", {
    allowedContentTypes: [...UPLOAD_CONTENT_TYPES[purpose]],
  });
}
