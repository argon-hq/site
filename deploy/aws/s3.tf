# Nightly Postgres dumps land here (../backup-db.sh). Retention is a lifecycle rule on the
# bucket, not logic in the script. There is no bucket policy: access comes from the instance
# role alone.

resource "aws_s3_bucket" "backups" {
  bucket = "argon-db-backups-${var.account_id}"

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.account_id
      error_message = "Wrong credentials: this configuration is for account ${var.account_id}. Check AWS_PROFILE."
    }
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket = aws_s3_bucket.backups.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    bucket_key_enabled = true

    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Never versioned: a dump is immutable and expires on its own. "Disabled" is the status the
# provider expects for a bucket that has never had versioning turned on.
resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id

  versioning_configuration {
    status = "Disabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "expira-dumps-em-30-dias"
    status = "Enabled"

    filter {
      prefix = "postgres/"
    }

    expiration {
      days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 3
    }
  }
}
