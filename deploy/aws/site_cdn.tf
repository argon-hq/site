# The site as static files (apps/web built with `output: "export"`) in a private bucket, served by
# one CloudFront distribution per environment, in place of the web containers on the EC2.
#
# Each locale is a folder (/pt-BR/..., /en-US/...), and the URLs stay unprefixed, as they are in the
# e-mails already sent: a CloudFront Function (site_router.js) picks the folder by the `locale`
# cookie the locale switcher writes, maps a page path to its index.html, and redirects www to the
# canonical host. The headers the Next server used to send
# (CSP, Referrer-Policy) come from a response headers policy.
#
# The deploy workflow builds each environment with its own origins, syncs the files to
# s3://<bucket>/<env>/ and invalidates the distribution.

variable "site_domains" {
  description = "Hostnames served by each environment's site distribution; the first is the canonical one. The others are redirected to it."
  type        = map(list(string))
  # One environment at a time: an environment joins when its site moves off the EC2. Next one:
  #   prod = ["argonbusiness.com", "www.argonbusiness.com"]
  # The old *.argon.eduardofockink.com site names are not carried over (decided on 04/11/2026):
  # everything lives on argonbusiness.com. They redirect from Caddy until the EC2 goes.
  default = {
    lab = ["lab.argonbusiness.com"]
    dev = ["dev.argonbusiness.com"]
  }
}

variable "site_api_origins" {
  description = "The API each environment's site calls from the browser: the CSP's connect-src."
  type        = map(string)
  default = {
    lab  = "https://api.lab.argonbusiness.com"
    dev  = "https://api.dev.argonbusiness.com"
    prod = "https://api.argonbusiness.com"
  }
}

resource "aws_s3_bucket" "site" {
  bucket = "argon-site-${var.account_id}"
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "argon-site"
  description                       = "CloudFront reads the Argon site bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Only the site distributions read the bucket, each through its own environment folder.
data "aws_iam_policy_document" "site_bucket" {
  statement {
    sid       = "CloudFrontLeOSite"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [for d in aws_cloudfront_distribution.site : d.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site_bucket.json
}

resource "aws_cloudfront_function" "site_router" {
  for_each = var.site_domains

  name    = "argon-${each.key}-site-router"
  runtime = "cloudfront-js-2.0"
  comment = "Argon ${each.key} site: locale folder, index.html, redirects to ${each.value[0]}"
  publish = true
  code    = replace(file("${path.module}/site_router.js"), "__CANONICAL_HOST__", each.value[0])
}

# The headers apps/web/src/lib/security-headers.ts documents. The token pages
# (/newsletter/confirm, /newsletter/unsubscribe) needed no-referrer; the whole site gets it, which
# costs nothing on a site that links out to no one who counts referrers.
resource "aws_cloudfront_response_headers_policy" "site" {
  for_each = var.site_domains

  name    = "argon-${each.key}-site"
  comment = "Argon ${each.key} site: CSP and Referrer-Policy"

  security_headers_config {
    content_security_policy {
      override = true
      content_security_policy = join("; ", [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self' ${var.site_api_origins[each.key]}",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ])
    }
    referrer_policy {
      override        = true
      referrer_policy = "no-referrer"
    }
    content_type_options {
      override = true
    }
    strict_transport_security {
      override                   = true
      access_control_max_age_sec = 31536000
      include_subdomains         = false
    }
  }
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_acm_certificate" "site" {
  for_each = var.site_domains
  provider = aws.us_east_1

  domain_name               = each.value[0]
  subject_alternative_names = slice(each.value, 1, length(each.value))
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "site" {
  for_each = var.site_domains
  provider = aws.us_east_1

  certificate_arn = aws_acm_certificate.site[each.key].arn

  timeouts {
    create = "30m"
  }
}

resource "aws_cloudfront_distribution" "site" {
  for_each = var.site_domains

  enabled         = true
  comment         = "argon ${each.key} site"
  aliases         = each.value
  is_ipv6_enabled = true
  http_version    = "http2and3"
  price_class     = "PriceClass_All"

  origin {
    origin_id                = "s3"
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_path              = "/${each.key}"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id           = "s3"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site[each.key].id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.site_router[each.key].arn
    }
  }

  # A path that exists in no locale folder: the bucket answers 403 to what it does not have. The
  # export's 404.html is Next's default page, not localized (the root layout is under [locale]).
  custom_error_response {
    error_code         = 403
    response_code      = 404
    response_page_path = "/404.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site[each.key].certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

output "site_certificate_validation" {
  description = "CNAME records to create in Cloudflare (DNS only) so ACM issues each site certificate."
  value = {
    for env, cert in aws_acm_certificate.site : env => [
      for o in cert.domain_validation_options : { name = o.resource_record_name, value = o.resource_record_value }
    ]
  }
}

output "site_cloudfront" {
  description = "Each environment's site distribution: where its hostnames point, and what the deploy invalidates."
  value       = { for env, d in aws_cloudfront_distribution.site : env => { domain = d.domain_name, id = d.id } }
}
