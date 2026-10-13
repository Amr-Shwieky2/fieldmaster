import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Equals, IsIn, IsOptional, IsString, Matches, MaxLength } from "class-validator";
import { GovernmentIdType, PRIVACY_NOTICE_VERSION } from "@fieldmaster/shared-types";
import { isValidBankAccountNumber, isValidBankBranchNumber, isValidE164PhoneNumber } from "@fieldmaster/shared-validation";
import { UUID_PATTERN } from "../../../common/validation/patterns";
import { NOT_BLANK, Raw, Satisfies, Trimmed, TrimmedOrAbsent } from "./validation";

/**
 * `POST /onboarding/invitations/:token/redeem` (public): the worker's
 * application. Shapes are checked with the shared validators, the same ones
 * the onboarding page uses. The ID number is checked by its type's rule in
 * OnboardingService (a failure names the field in `details`). Messages never
 * include the submitted values.
 */
export class JoinApplicationDto {
  @ApiProperty({ example: "+972501234567", description: "E.164: the number the worker signs in with." })
  @Trimmed()
  @IsString()
  @Satisfies(isValidE164PhoneNumber, "phoneNumber must be an international (E.164) phone number")
  phoneNumber!: string;

  @ApiProperty()
  @Trimmed()
  @IsString()
  @Matches(NOT_BLANK, { message: "fullLegalName must not be blank" })
  @MaxLength(200)
  fullLegalName!: string;

  @ApiPropertyOptional()
  @TrimmedOrAbsent()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  preferredName?: string;

  @ApiProperty({ enum: Object.values(GovernmentIdType) })
  @IsIn(Object.values(GovernmentIdType))
  governmentIdType!: GovernmentIdType;

  @ApiProperty({ description: "Checked by the rule of governmentIdType (isValidGovernmentIdNumber); stored encrypted." })
  @Trimmed()
  @IsString()
  governmentIdNumber!: string;

  @ApiProperty({ description: "An IDENTITY_DOCUMENT upload of this invitation." })
  @IsString()
  @Matches(UUID_PATTERN, { message: "identityDocumentAssetId must be an upload id" })
  identityDocumentAssetId!: string;

  @ApiPropertyOptional({ description: "A PROFILE_PHOTO upload of this invitation." })
  @TrimmedOrAbsent()
  @IsOptional()
  @IsString()
  @Matches(UUID_PATTERN, { message: "profilePhotoAssetId must be an upload id" })
  profilePhotoAssetId?: string;

  @ApiProperty()
  @Trimmed()
  @IsString()
  @Matches(NOT_BLANK, { message: "bankName must not be blank" })
  @MaxLength(100)
  bankName!: string;

  @ApiProperty()
  @Trimmed()
  @IsString()
  @Satisfies(isValidBankBranchNumber, "branchNumber must be 1 to 4 digits")
  branchNumber!: string;

  @ApiProperty()
  @Trimmed()
  @IsString()
  @Satisfies(isValidBankAccountNumber, "accountNumber must be 2 to 20 digits")
  accountNumber!: string;

  @ApiProperty()
  @Trimmed()
  @IsString()
  @Matches(NOT_BLANK, { message: "accountHolderName must not be blank" })
  @MaxLength(200)
  accountHolderName!: string;

  @ApiProperty({ enum: [true], description: "Consent is mandatory to submit an application." })
  @Raw()
  @Equals(true, { message: "consentAccepted must be true" })
  consentAccepted!: true;

  @ApiProperty({ example: PRIVACY_NOTICE_VERSION, description: "The privacy notice version the worker accepted: the current one." })
  @IsString()
  @Equals(PRIVACY_NOTICE_VERSION, { message: "privacyNoticeVersion must be the current privacy notice version" })
  privacyNoticeVersion!: string;
}
