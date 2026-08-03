variable "aws_region" {
  type    = string
  default = "il-central-1" # AWS's Israel (Tel Aviv) region -- lowest latency to Asia/Jerusalem-based crews
}

variable "aws_account_id" {
  description = "Used only to build a globally-unique S3 bucket suffix. Set via terraform.tfvars or -var, never hardcoded."
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate ARN for the production domain's HTTPS listener. Leave null for a first bootstrap deploy without a custom domain yet."
  type        = string
  default     = null
}

variable "api_image_tag" {
  description = "Container image tag to deploy, e.g. a git SHA pushed by CI. No default -- must be set explicitly per deploy."
  type        = string
}

variable "admin_web_image_tag" {
  type = string
}

variable "public_api_url" {
  type    = string
  default = "https://api.fieldmaster.example.com/api/v1" # replace with the real production domain
}
