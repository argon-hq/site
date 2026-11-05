# One log group per environment's API, where both its Lambda functions write (lambda.tf). Owning
# them here fixes the retention and lets the metric filters in alarms.tf reference the prod API
# group before the first log line.

locals {
  environments = ["prod", "dev", "lab"]

  log_groups = toset([for env in local.environments : "/argon/${env}/api"])
}

resource "aws_cloudwatch_log_group" "argon" {
  for_each = local.log_groups

  name              = each.key
  retention_in_days = var.log_retention_days
  log_group_class   = "STANDARD"
}
