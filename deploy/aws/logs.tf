# One log group per container (../compose.yml, awslogs driver). The driver would create them on
# first write, without retention; owning them here fixes the retention and lets the metric
# filters in alarms.tf reference the prod API group before the first log line.

locals {
  environments = ["prod", "dev", "lab"]

  log_groups = toset(concat(
    flatten([for env in local.environments : ["/argon/${env}/web", "/argon/${env}/api"]]),
    ["/argon/postgres"],
  ))
}

resource "aws_cloudwatch_log_group" "argon" {
  for_each = local.log_groups

  name              = each.key
  retention_in_days = var.log_retention_days
  log_group_class   = "STANDARD"
}
