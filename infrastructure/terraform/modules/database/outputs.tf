output "endpoint" {
  value = aws_db_instance.this.address
}

output "port" {
  value = aws_db_instance.this.port
}

output "instance_id" {
  value = aws_db_instance.this.id
}

output "credentials_secret_arn" {
  description = "Secrets Manager ARN holding {username, password, host, port, dbname, url} -- reference this from the ECS task definition, never the raw values."
  value       = aws_secretsmanager_secret.db_credentials.arn
}
