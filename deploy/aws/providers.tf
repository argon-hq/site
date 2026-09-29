provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project = "argon"
    }
  }
}

# Route 53 health-check metrics only exist in us-east-1, so the alarm on them, and the SNS topic
# it notifies, live there too. Everything else stays in sa-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project = "argon"
    }
  }
}
