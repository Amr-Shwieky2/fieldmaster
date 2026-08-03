output "jwt_access_secret_arn" {
  value = aws_secretsmanager_secret.jwt_access_secret.arn
}

output "jwt_refresh_secret_arn" {
  value = aws_secretsmanager_secret.jwt_refresh_secret.arn
}

output "encryption_key_secret_arn" {
  value = aws_secretsmanager_secret.encryption_key.arn
}

output "twilio_secret_arn" {
  value = aws_secretsmanager_secret.twilio.arn
}

output "firebase_secret_arn" {
  value = aws_secretsmanager_secret.firebase.arn
}

output "sentry_secret_arn" {
  value = aws_secretsmanager_secret.sentry.arn
}
