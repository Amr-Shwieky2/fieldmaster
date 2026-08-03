terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state is intentionally not configured here -- this repository
  # has never been applied against a real AWS account (see
  # docs/deployment.md), so no S3 bucket/DynamoDB lock table exists yet to
  # point at. Bootstrap one first (see deployment.md's "First apply"
  # section), then uncomment and fill in:
  #
  # backend "s3" {
  #   bucket         = "fieldmaster-terraform-state-<account-id>"
  #   key            = "production/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "fieldmaster-terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = local.common_tags
  }
}
