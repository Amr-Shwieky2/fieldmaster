# Application-level secrets not already created by the database/redis
# modules (which manage their own credentials directly). This module only
# creates the Secrets Manager *containers* -- values are written out of
# band (`aws secretsmanager put-secret-value`, or via a deploy pipeline
# step) rather than passed as Terraform variables, so they never appear in
# `terraform plan` output or state as plaintext.

resource "aws_secretsmanager_secret" "jwt_access_secret" {
  name       = "${var.name_prefix}/auth/jwt-access-secret"
  kms_key_id = var.kms_key_arn
  tags       = var.tags
}

resource "aws_secretsmanager_secret" "jwt_refresh_secret" {
  name       = "${var.name_prefix}/auth/jwt-refresh-secret"
  kms_key_id = var.kms_key_arn
  tags       = var.tags
}

resource "aws_secretsmanager_secret" "encryption_key" {
  name        = "${var.name_prefix}/security/local-encryption-key"
  description = "Base64-encoded 32-byte AES-256 key -- envelope-encryption fallback / EncryptionService input. Production should prefer KMS-native envelope encryption over this where possible; see docs/security.md."
  kms_key_id  = var.kms_key_arn
  tags        = var.tags
}

resource "aws_secretsmanager_secret" "twilio" {
  name        = "${var.name_prefix}/integrations/twilio"
  description = "JSON: { accountSid, authToken, verifyServiceSid }"
  kms_key_id  = var.kms_key_arn
  tags        = var.tags
}

resource "aws_secretsmanager_secret" "firebase" {
  name        = "${var.name_prefix}/integrations/firebase"
  description = "JSON: Firebase Admin SDK service-account credentials for FCM push delivery"
  kms_key_id  = var.kms_key_arn
  tags        = var.tags
}

resource "aws_secretsmanager_secret" "sentry" {
  name       = "${var.name_prefix}/integrations/sentry-dsn"
  kms_key_id = var.kms_key_arn
  tags       = var.tags
}
