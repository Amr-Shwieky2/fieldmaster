# RDS PostgreSQL. PostGIS itself needs no special parameter-group setting
# on RDS (the master user is granted rds_superuser, sufficient to run
# `CREATE EXTENSION postgis`) -- that happens once, automatically, the
# first time Prisma's baseline migration runs against a fresh database
# (apps/api/prisma/migrations/20260803035740_init includes it).
# `pg_stat_statements` below is unrelated -- general query-performance
# visibility, requires shared_preload_libraries + an instance reboot.

resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-db"
  subnet_ids = var.private_subnet_ids
  tags       = var.tags
}

resource "aws_db_parameter_group" "this" {
  name   = "${var.name_prefix}-pg17"
  family = "postgres17"

  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements"
  }

  tags = var.tags
}

resource "random_password" "master" {
  length  = 32
  special = false # RDS master passwords reject some special characters; alphanumeric avoids escaping issues entirely
}

resource "aws_db_instance" "this" {
  identifier     = "${var.name_prefix}-postgres"
  engine         = "postgres"
  engine_version = "17.2"

  instance_class        = var.instance_class
  allocated_storage     = var.allocated_storage_gb
  max_allocated_storage = var.max_allocated_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = var.kms_key_arn

  db_name  = var.database_name
  username = "fieldmaster_admin"
  password = random_password.master.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.this.name
  parameter_group_name   = aws_db_parameter_group.this.name
  vpc_security_group_ids = [var.security_group_id]
  publicly_accessible    = false

  multi_az                  = var.multi_az
  backup_retention_period   = var.backup_retention_days
  backup_window             = "03:00-04:00"
  maintenance_window        = "mon:04:30-mon:05:30"
  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = !var.deletion_protection
  final_snapshot_identifier = var.deletion_protection ? "${var.name_prefix}-postgres-final" : null

  performance_insights_enabled = var.performance_insights_enabled

  tags = merge(var.tags, { Name = "${var.name_prefix}-postgres" })
}

# The master password is written to Secrets Manager (not output as plain
# Terraform state where it can be avoided) so the API's ECS task definition
# can reference it via a secret ARN rather than an environment variable.
resource "aws_secretsmanager_secret" "db_credentials" {
  name       = "${var.name_prefix}/database/credentials"
  kms_key_id = var.kms_key_arn
  tags       = var.tags
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id
  secret_string = jsonencode({
    username = aws_db_instance.this.username
    password = random_password.master.result
    host     = aws_db_instance.this.address
    port     = aws_db_instance.this.port
    dbname   = aws_db_instance.this.db_name
    url      = "postgresql://${aws_db_instance.this.username}:${random_password.master.result}@${aws_db_instance.this.address}:${aws_db_instance.this.port}/${aws_db_instance.this.db_name}?schema=public"
  })
}
