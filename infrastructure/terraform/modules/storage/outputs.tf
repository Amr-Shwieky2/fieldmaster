output "kms_key_arn" {
  value = aws_kms_key.this.arn
}

output "files_bucket_name" {
  value = aws_s3_bucket.files.id
}

output "files_bucket_arn" {
  value = aws_s3_bucket.files.arn
}

output "web_assets_bucket_name" {
  value = aws_s3_bucket.web_assets.id
}

output "cloudfront_domain_name" {
  value = aws_cloudfront_distribution.web_assets.domain_name
}
