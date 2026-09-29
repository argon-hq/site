terraform {
  # Import blocks with for_each need 1.7; the S3 backend's `use_lockfile` needs 1.10.
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
