# ElastiCache Redis, used by BullMQ (background jobs) and as the shared
# session/cache layer. A single-node replication group in dev/staging;
# set num_cache_clusters > 1 in production for automatic failover.

resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name_prefix}-redis"
  subnet_ids = var.private_subnet_ids
  tags       = var.tags
}

resource "random_password" "auth_token" {
  length  = 40
  special = false # ElastiCache AUTH tokens disallow several special characters
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = "${var.name_prefix}-redis"
  description          = "FieldMaster BullMQ + cache Redis"

  engine         = "redis"
  engine_version = "7.1"
  node_type      = var.node_type
  port           = 6379

  num_cache_clusters         = var.num_cache_clusters
  automatic_failover_enabled = var.num_cache_clusters > 1
  multi_az_enabled           = var.num_cache_clusters > 1

  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [var.security_group_id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.auth_token.result
  kms_key_id                 = var.kms_key_arn

  snapshot_retention_limit = var.snapshot_retention_days

  tags = merge(var.tags, { Name = "${var.name_prefix}-redis" })
}

# BullMQ/ioredis need both the endpoint and the AUTH token; stored together
# so the ECS task definition pulls one secret rather than assembling a
# connection string from separate values at runtime.
resource "aws_secretsmanager_secret" "redis_credentials" {
  name       = "${var.name_prefix}/redis/credentials"
  kms_key_id = var.kms_key_arn
  tags       = var.tags
}

resource "aws_secretsmanager_secret_version" "redis_credentials" {
  secret_id = aws_secretsmanager_secret.redis_credentials.id
  secret_string = jsonencode({
    host       = aws_elasticache_replication_group.this.primary_endpoint_address
    port       = 6379
    auth_token = random_password.auth_token.result
    url        = "rediss://:${random_password.auth_token.result}@${aws_elasticache_replication_group.this.primary_endpoint_address}:6379"
  })
}
