# This is a shared cloud "dev" environment (e.g. for demoing to
# stakeholders or QA against a persistent URL) -- day-to-day development
# uses `docker compose up -d` locally (see the root README), not this.
# Sized down aggressively: single AZ, no NAT redundancy, smallest instance
# classes, no deletion protection, short log retention.

locals {
  name_prefix = "fieldmaster-dev"
  common_tags = {
    Project     = "FieldMaster"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
  ecr_registry = "${var.aws_account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
}

module "networking" {
  source = "../../modules/networking"

  name_prefix    = local.name_prefix
  vpc_cidr       = "10.32.0.0/16"
  az_count       = 2 # an ALB requires at least 2 AZs even in the smallest deployment
  one_nat_per_az = false
  tags           = local.common_tags
}

module "storage" {
  source = "../../modules/storage"

  name_prefix    = local.name_prefix
  account_suffix = var.aws_account_id
  tags           = local.common_tags
}

module "secrets" {
  source = "../../modules/secrets"

  name_prefix = local.name_prefix
  kms_key_arn = module.storage.kms_key_arn
  tags        = local.common_tags
}

module "database" {
  source = "../../modules/database"

  name_prefix           = local.name_prefix
  private_subnet_ids    = module.networking.private_subnet_ids
  security_group_id     = module.networking.rds_security_group_id
  kms_key_arn           = module.storage.kms_key_arn
  instance_class        = "db.t4g.micro"
  allocated_storage_gb  = 20
  multi_az              = false
  backup_retention_days = 1
  deletion_protection   = false
  tags                  = local.common_tags
}

module "redis" {
  source = "../../modules/redis"

  name_prefix        = local.name_prefix
  private_subnet_ids = module.networking.private_subnet_ids
  security_group_id  = module.networking.redis_security_group_id
  kms_key_arn        = module.storage.kms_key_arn
  node_type          = "cache.t4g.micro"
  num_cache_clusters = 1
  tags               = local.common_tags
}

module "ecs" {
  source = "../../modules/ecs"

  name_prefix                 = local.name_prefix
  aws_region                  = var.aws_region
  environment                 = "development"
  vpc_id                      = module.networking.vpc_id
  public_subnet_ids           = module.networking.public_subnet_ids
  private_subnet_ids          = module.networking.private_subnet_ids
  alb_security_group_id       = module.networking.alb_security_group_id
  ecs_tasks_security_group_id = module.networking.ecs_tasks_security_group_id

  api_image       = "${local.ecr_registry}/fieldmaster-api:${var.api_image_tag}"
  admin_web_image = "${local.ecr_registry}/fieldmaster-admin-web:${var.admin_web_image_tag}"
  public_api_url  = var.public_api_url

  api_cpu           = 256
  api_memory        = 512
  api_desired_count = 1
  api_max_count     = 1

  admin_web_cpu           = 256
  admin_web_memory        = 512
  admin_web_desired_count = 1

  log_retention_days = 7

  kms_key_arn                  = module.storage.kms_key_arn
  files_bucket_arn             = module.storage.files_bucket_arn
  db_credentials_secret_arn    = module.database.credentials_secret_arn
  redis_credentials_secret_arn = module.redis.credentials_secret_arn
  jwt_access_secret_arn        = module.secrets.jwt_access_secret_arn
  jwt_refresh_secret_arn       = module.secrets.jwt_refresh_secret_arn
  encryption_key_secret_arn    = module.secrets.encryption_key_secret_arn

  secret_arns = [
    module.database.credentials_secret_arn,
    module.redis.credentials_secret_arn,
    module.secrets.jwt_access_secret_arn,
    module.secrets.jwt_refresh_secret_arn,
    module.secrets.encryption_key_secret_arn,
    module.secrets.twilio_secret_arn,
    module.secrets.firebase_secret_arn,
    module.secrets.sentry_secret_arn,
  ]

  tags = local.common_tags
}
