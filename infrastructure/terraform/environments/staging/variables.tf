variable "aws_region" {
  type    = string
  default = "il-central-1"
}

variable "aws_account_id" {
  type = string
}

variable "certificate_arn" {
  type    = string
  default = null
}

variable "api_image_tag" {
  type = string
}

variable "admin_web_image_tag" {
  type = string
}

variable "public_api_url" {
  type    = string
  default = "https://api-staging.fieldmaster.example.com/api/v1"
}
