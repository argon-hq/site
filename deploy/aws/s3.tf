# The account Terraform runs against; the buckets refuse to be created anywhere else.
data "aws_caller_identity" "current" {}

# Nightly Postgres dumps land here (the backup job, lambda.tf), and the monthly restore drill reads
# them back. Retention is a lifecycle rule on the bucket, not logic in the job. There is no bucket
# policy: access comes from the production functions' role alone.

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

# Versioned and locked (06/11/2026): a mistake or a stolen credential cannot erase the dumps.
# Object Lock in governance mode keeps every dump for 30 days; deleting one earlier takes the
# s3:BypassGovernanceRetention permission on purpose. Once on, Object Lock cannot be turned off
# for the bucket. Uploads must carry a checksum, which the AWS SDK v3 sends by default (backup.ts).
resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = 30
    }
  }

  depends_on = [aws_s3_bucket_versioning.backups]
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

    # With versioning, expiring a dump only hides it behind a delete marker; the old version goes
    # a day later, once its 30-day lock has run out.
    noncurrent_version_expiration {
      noncurrent_days = 1
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 3
    }
  }

  rule {
    id     = "limpa-marcadores-de-delecao"
    status = "Enabled"

    filter {
      prefix = "postgres/"
    }

    expiration {
      expired_object_delete_marker = true
    }
  }
}
