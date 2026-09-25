# One object per file of apps/web/public. The etag is the file's MD5, so a changed file is
# uploaded again, a new one is created, a deleted one is removed from the bucket and the rest
# is left alone. Short cache: a file keeps its name when the brand changes.

locals {
  public_dir = var.public_dir != "" ? var.public_dir : "${path.module}/../../../apps/web/public"
  files      = fileset(local.public_dir, "**")

  content_types = {
    css         = "text/css; charset=utf-8"
    gif         = "image/gif"
    html        = "text/html; charset=utf-8"
    ico         = "image/x-icon"
    jpeg        = "image/jpeg"
    jpg         = "image/jpeg"
    js          = "text/javascript; charset=utf-8"
    json        = "application/json"
    pdf         = "application/pdf"
    png         = "image/png"
    svg         = "image/svg+xml"
    txt         = "text/plain; charset=utf-8"
    webmanifest = "application/manifest+json"
    webp        = "image/webp"
    woff        = "font/woff"
    woff2       = "font/woff2"
    xml         = "application/xml"
  }
}

resource "aws_s3_object" "public" {
  for_each = local.files

  bucket        = var.bucket
  key           = "${var.env}/${each.value}"
  source        = "${local.public_dir}/${each.value}"
  etag          = filemd5("${local.public_dir}/${each.value}")
  content_type  = lookup(local.content_types, lower(reverse(split(".", each.value))[0]), "application/octet-stream")
  cache_control = "public, max-age=300"
}

output "base_url" {
  description = "Where this environment's files are served from."
  value       = "https://${var.bucket}.s3.${var.region}.amazonaws.com/${var.env}"
}

output "files" {
  description = "Number of files published."
  value       = length(local.files)
}
