variable "name_prefix" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "alb_security_group_id" {
  type = string
}

variable "ecs_tasks_security_group_id" {
  type = string
}

variable "certificate_arn" {
  description = "ACM certificate ARN for the ALB's HTTPS listener. null = HTTP-only (bootstrap deploys with no custom domain yet)."
  type        = string
  default     = null
}

variable "api_image" {
  description = "Full ECR image URI for the API, e.g. <account>.dkr.ecr.<region>.amazonaws.com/fieldmaster-api:<tag>. Built from apps/api/Dockerfile."
  type        = string
}

variable "admin_web_image" {
  description = "Full ECR image URI for admin-web."
  type        = string
}

variable "public_api_url" {
  description = "Public URL the browser calls, e.g. https://api.fieldmaster.example.com/api/v1"
  type        = string
}

variable "api_cpu" {
  type    = number
  default = 512
}

variable "api_memory" {
  type    = number
  default = 1024
}

variable "api_desired_count" {
  type    = number
  default = 2
}

variable "api_max_count" {
  type    = number
  default = 6
}

variable "admin_web_cpu" {
  type    = number
  default = 256
}

variable "admin_web_memory" {
  type    = number
  default = 512
}

variable "admin_web_desired_count" {
  type    = number
  default = 2
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "kms_key_arn" {
  type = string
}

variable "files_bucket_arn" {
  type = string
}

variable "db_credentials_secret_arn" {
  type = string
}

variable "redis_credentials_secret_arn" {
  type = string
}

variable "jwt_access_secret_arn" {
  type = string
}

variable "jwt_refresh_secret_arn" {
  type = string
}

variable "encryption_key_secret_arn" {
  type = string
}

variable "secret_arns" {
  description = "Every secret ARN the execution role needs read access to (all of the above, gathered into one list for the IAM policy)."
  type        = list(string)
}

variable "tags" {
  type    = map(string)
  default = {}
}
