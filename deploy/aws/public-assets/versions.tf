# Writes apps/web/public into the public bucket, under <env>/. The deploy workflow runs it on every
# deploy that touches the folder; the bucket itself belongs to the root one level up.
#
# The state key is per environment and comes from the command line:
#   terraform init -backend-config=key=public-assets/<env>.tfstate
# The deploy role can read and write that prefix of the state bucket and nothing else in it.
terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket       = "argon-terraform-state-382597877834"
    region       = "sa-east-1"
    encrypt      = true
    use_lockfile = true

    # Any workspace listing stays under the one prefix the deploy role can see.
    workspace_key_prefix = "public-assets/workspaces"
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project = "argon"
    }
  }
}
