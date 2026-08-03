variable "aws_region" {
  type    = string
  default = "il-central-1"
}

variable "aws_account_id" {
  type = string
}

variable "api_image_tag" {
  type    = string
  default = "latest"
}

variable "admin_web_image_tag" {
  type    = string
  default = "latest"
}

variable "public_api_url" {
  type    = string
  default = "https://api-dev.fieldmaster.example.com/api/v1"
}
