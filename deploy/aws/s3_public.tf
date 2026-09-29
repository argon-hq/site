# Public files: everything under apps/web/public (brand files, e-mail images), one prefix per
# environment (dev/, prod/, lab/). The bucket and its policy live here and are applied by hand
# like the rest of this root; the objects are written by the deploy workflow through the
# ./public-assets root, which never touches the bucket itself.
#
# Anyone can read an object; nobody can list the bucket. ACLs stay off: access comes from the
# bucket policy alone.

resource "aws_s3_bucket" "public" {
  bucket = "argon-public-${var.account_id}"

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.account_id
      error_message = "Wrong credentials: this configuration is for account ${var.account_id}. Check AWS_PROFILE."
    }
  }
}

# Only the two settings that would reject the public read policy are off. If the account itself
# blocks public policies (s3control public access block), the policy below is refused: see
# README.md, "Arquivos públicos".
resource "aws_s3_bucket_public_access_block" "public" {
  bucket = aws_s3_bucket.public.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_ownership_controls" "public" {
  bucket = aws_s3_bucket.public.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "public" {
  bucket = aws_s3_bucket.public.id

  rule {
    bucket_key_enabled = true

    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# The files are in git; the bucket is a copy of the repository, so there is nothing to version.
resource "aws_s3_bucket_versioning" "public" {
  bucket = aws_s3_bucket.public.id

  versioning_configuration {
    status = "Disabled"
  }
}

data "aws_iam_policy_document" "public_read" {
  statement {
    sid       = "LeituraPublica"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.public.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

# The public access block has to be relaxed before S3 accepts a public policy.
resource "aws_s3_bucket_policy" "public" {
  bucket = aws_s3_bucket.public.id
  policy = data.aws_iam_policy_document.public_read.json

  depends_on = [aws_s3_bucket_public_access_block.public]
}

# Fonts and SVGs loaded by other origins (the site, the prototypes) need CORS on GET.
resource "aws_s3_bucket_cors_configuration" "public" {
  bucket = aws_s3_bucket.public.id

  cors_rule {
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"]
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}
