variable "name_prefix" {
  type = string
}

variable "account_suffix" {
  description = "Short unique suffix (e.g. the AWS account ID) appended to bucket names, since S3 bucket names are globally unique."
  type        = string
}

variable "cloudfront_price_class" {
  type    = string
  default = "PriceClass_100"
}

variable "tags" {
  type    = map(string)
  default = {}
}
