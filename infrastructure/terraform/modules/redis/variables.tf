variable "name_prefix" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "security_group_id" {
  type = string
}

variable "kms_key_arn" {
  type = string
}

variable "node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "num_cache_clusters" {
  description = "1 = single node (dev/staging). 2+ = automatic failover with a replica (production)."
  type        = number
  default     = 1
}

variable "snapshot_retention_days" {
  type    = number
  default = 3
}

variable "tags" {
  type    = map(string)
  default = {}
}
