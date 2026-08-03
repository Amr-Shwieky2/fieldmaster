# S3 buckets for private file storage (PDF reports, future identity
# documents/audio) + a CloudFront distribution in front of the admin-web
# static assets. Both buckets are fully private -- the API generates
# short-lived signed URLs for any object a client needs to read directly
# (see FileStorageService / S3 adapter in apps/api).

resource "aws_kms_key" "this" {
  description             = "${var.name_prefix} encryption key (S3, RDS, ElastiCache, Secrets Manager)"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = var.tags
}

resource "aws_kms_alias" "this" {
  name          = "alias/${var.name_prefix}"
  target_key_id = aws_kms_key.this.key_id
}

resource "aws_s3_bucket" "files" {
  bucket = "${var.name_prefix}-files-${var.account_suffix}"
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "files" {
  bucket                  = aws_s3_bucket.files.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "files" {
  bucket = aws_s3_bucket.files.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.this.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "files" {
  bucket = aws_s3_bucket.files.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Retention defaults (spec section 32: "no required evidence should be
# automatically removed while a payroll period or dispute is active").
# This lifecycle rule is deliberately conservative -- it only expires
# non-current (already-superseded) object *versions*, never the current
# version of any object, and only after a long window.
resource "aws_s3_bucket_lifecycle_configuration" "files" {
  bucket = aws_s3_bucket.files.id
  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"
    filter {} # empty filter = applies to every object in the bucket
    noncurrent_version_expiration {
      noncurrent_days = 365
    }
  }
}

resource "aws_s3_bucket" "web_assets" {
  bucket = "${var.name_prefix}-web-assets-${var.account_suffix}"
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "web_assets" {
  bucket                  = aws_s3_bucket.web_assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "web_assets" {
  name                              = "${var.name_prefix}-web-assets-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "web_assets" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = var.cloudfront_price_class

  origin {
    domain_name              = aws_s3_bucket.web_assets.bucket_regional_domain_name
    origin_id                = "web-assets"
    origin_access_control_id = aws_cloudfront_origin_access_control.web_assets.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "web-assets"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true # replace with an ACM cert + aliases for a real custom domain
  }

  tags = var.tags
}

resource "aws_s3_bucket_policy" "web_assets_cloudfront" {
  bucket = aws_s3_bucket.web_assets.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontServicePrincipal"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.web_assets.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.web_assets.arn
        }
      }
    }]
  })
}
