# CloudFront in front of each environment's API function URL, on the API hostnames. Nothing is
# cached: every request reaches the function, with every viewer header but Host (a function URL
# only answers its own hostname). The certificate is ACM's, in us-east-1 as CloudFront requires,
# validated by a CNAME in the Cloudflare zone, which Terraform does not manage: the record to create
# is in the `api_certificate_validation` output, and the apply waits for it.

variable "api_domains" {
  description = "API hostnames served by CloudFront, per environment. The first is the certificate's main name."
  type        = map(list(string))
  default = {
    lab = ["api.lab.argonbusiness.com"]
    # The old name stays until 02/02/2027: e-mails already sent link their one-click unsubscribe to
    # it. Its record lives in the Route 53 zone of account 663702377780.
    prod = ["api.argonbusiness.com", "api.argon.eduardofockink.com"]
  }
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

# What the API reads from a request, plus CloudFront-Viewer-Address, the visitor's address as
# CloudFront saw it (apps/api/src/net/cloudfront.ts). A list rather than "every viewer header":
# CloudFront's own headers only travel when named, and the managed policies that name them also
# forward Host, which a function URL refuses. A header the API starts reading goes here too.
resource "aws_cloudfront_origin_request_policy" "api" {
  name    = "argon-api"
  comment = "Argon API on Lambda: the headers it reads, and the visitor's address"

  headers_config {
    header_behavior = "whitelist"
    headers {
      items = [
        "accept",
        "accept-language",
        "access-control-request-headers",
        "access-control-request-method",
        "content-type",
        "origin",
        "user-agent",
        "x-internal-secret",
        "CloudFront-Viewer-Address",
      ]
    }
  }

  query_strings_config {
    query_string_behavior = "all"
  }

  cookies_config {
    cookie_behavior = "none"
  }
}

# Proves to the API function that a request came through CloudFront. It lives in the Terraform
# state and in the function's environment, not in the Parameter Store: the EC2 reads every
# parameter of its environment and would start refusing what Caddy forwards.
resource "random_password" "origin_verify" {
  for_each = toset(var.lambda_environments)

  length  = 48
  special = false
}

resource "aws_acm_certificate" "api" {
  for_each = var.api_domains
  provider = aws.us_east_1

  domain_name               = each.value[0]
  subject_alternative_names = slice(each.value, 1, length(each.value))
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "api" {
  for_each = var.api_domains
  provider = aws.us_east_1

  certificate_arn = aws_acm_certificate.api[each.key].arn

  timeouts {
    create = "30m"
  }
}

resource "aws_cloudfront_distribution" "api" {
  for_each = var.api_domains

  enabled         = true
  comment         = "argon ${each.key} API (Lambda)"
  aliases         = each.value
  is_ipv6_enabled = true
  http_version    = "http2and3"
  # Every edge, São Paulo included: the free tier is the same for any price class.
  price_class = "PriceClass_All"

  origin {
    origin_id   = "lambda"
    domain_name = trimsuffix(trimprefix(aws_lambda_function_url.api[each.key].function_url, "https://"), "/")

    custom_header {
      name  = "x-origin-verify"
      value = random_password.origin_verify[each.key].result
    }

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      # The edition run is a job, not a request; 30 s covers the slowest route plus a cold start.
      origin_read_timeout = 30
    }
  }

  default_cache_behavior {
    target_origin_id         = "lambda"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.api.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.api[each.key].certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

output "api_certificate_validation" {
  description = "CNAME records to create in Cloudflare (DNS only) so ACM issues each API certificate."
  value = {
    for env, cert in aws_acm_certificate.api : env => [
      for o in cert.domain_validation_options : {
        name  = o.resource_record_name
        type  = o.resource_record_type
        value = o.resource_record_value
      }
    ]
  }
}

output "api_cloudfront_domains" {
  description = "Where each API hostname points (CNAME in Cloudflare, DNS only)."
  value       = { for env, d in aws_cloudfront_distribution.api : env => d.domain_name }
}
