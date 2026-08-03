variable "name_prefix" {
  description = "Prefix applied to every resource name (e.g. \"fieldmaster-prod\")."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC. Must be large enough for public+private subnets across az_count AZs."
  type        = string
  default     = "10.20.0.0/16"
}

variable "az_count" {
  description = "Number of availability zones to spread subnets across (2 is the practical minimum for an ALB)."
  type        = number
  default     = 2
}

variable "one_nat_per_az" {
  description = "true = one NAT gateway per AZ (production: no single-AZ outage takes down egress). false = one shared NAT gateway (cheaper, fine for dev/staging)."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags applied to every resource this module creates."
  type        = map(string)
  default     = {}
}
