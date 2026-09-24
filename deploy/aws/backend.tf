# The state bucket is the one thing Terraform cannot create for itself: see README.md, "Estado".
# Locking uses the S3 lock file (Terraform 1.10+), so there is no DynamoDB table.
terraform {
  backend "s3" {
    bucket       = "argon-terraform-state-382597877834"
    key          = "site/terraform.tfstate"
    region       = "sa-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
