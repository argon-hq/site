provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project = "argon"
    }
  }
}

# CloudFront only takes certificates from us-east-1: the site's and the API's live there
# (site_cdn.tf, api_cdn.tf). Everything else stays in sa-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project = "argon"
    }
  }
}
