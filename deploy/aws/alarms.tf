# Observability from steps 2, 8 and 14 of the review plan: a silent morning must make noise.
# Nothing here exists in the account yet; the first apply creates all of it.
#
# The API logs JSON through Nest's ConsoleLogger. It wraps every log object under `message`:
#   {"level":"log","pid":1,"timestamp":...,"message":{"msg":"schedule fired",...},"context":"..."}
# so the message patterns look at `$.message.msg`, and the level at `$.level`.

locals {
  prod_api_log_group = aws_cloudwatch_log_group.argon["/argon/prod/api"].name

  api_log_metrics = {
    schedule_fired      = { pattern = "{ $.message.msg = \"schedule fired\" }", metric = "ScheduleFired" }
    send_finished       = { pattern = "{ $.message.msg = \"send finished\" }", metric = "SendFinished" }
    edition_stuck       = { pattern = "{ $.message.msg = \"edition stuck\" }", metric = "EditionStuck" }
    owner_alert_skipped = { pattern = "{ $.message.msg = \"owner alert skipped\" }", metric = "OwnerAlertSkipped" }
    errors              = { pattern = "{ $.level = \"error\" }", metric = "ApiErrors" }
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_log_metric_filter" "prod_api" {
  for_each = local.api_log_metrics

  name           = "argon-prod-api-${replace(each.key, "_", "-")}"
  log_group_name = local.prod_api_log_group
  pattern        = each.value.pattern

  metric_transformation {
    name      = each.value.metric
    namespace = "Argon"
    value     = "1"
    unit      = "Count"
  }
}

# ---- Heartbeats: something that must happen once a day did not ---------------------------
#
# `Sum < 1` over a one-day period, missing data counted as breaching. CloudWatch aligns one-day
# periods to the UTC day and, when the current day has no datapoint yet, evaluates the previous
# one, so the alarm does not fire every night before 05:30. It fires on the UTC day after a run
# is missed (around 21:00 BRT) and clears at the next run. There is no Sunday edition, so Sunday
# night through Monday 05:30 is a known false positive — accepted rather than adding a schedule
# to silence it. The plan wanted a check at 08:00 BRT; a single alarm cannot be that precise.

resource "aws_cloudwatch_metric_alarm" "schedule_fired" {
  alarm_name          = "argon-prod-schedule-not-fired"
  alarm_description   = "The 05:30 generation did not fire in prod (no `schedule fired` log in a day)."
  namespace           = "Argon"
  metric_name         = local.api_log_metrics.schedule_fired.metric
  statistic           = "Sum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "send_finished" {
  alarm_name          = "argon-prod-send-not-finished"
  alarm_description   = "The 07:00 send did not finish in prod (no `send finished` log in a day)."
  namespace           = "Argon"
  metric_name         = local.api_log_metrics.send_finished.metric
  statistic           = "Sum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# backup-db.sh (step 14) ends with `put-metric-data --namespace Argon --metric-name BackupOk
# --value 1`. The plan asked for "no datapoint in 26 h"; an alarm window is capped at one day,
# so this is the same calendar-day heartbeat as above. The backup runs at 03:30 BRT.
resource "aws_cloudwatch_metric_alarm" "backup_ok" {
  alarm_name          = "argon-backup-missing"
  alarm_description   = "No BackupOk metric in a day: the nightly Postgres dump did not run or did not finish."
  namespace           = "Argon"
  metric_name         = "BackupOk"
  statistic           = "Sum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# ---- Events: one occurrence is already a problem ------------------------------------------

resource "aws_cloudwatch_metric_alarm" "api_errors" {
  alarm_name          = "argon-prod-api-errors"
  alarm_description   = "At least one level=error log in the prod API within five minutes."
  namespace           = "Argon"
  metric_name         = local.api_log_metrics.errors.metric
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

# Logged at boot and at 08:00 BRT by the check from step 8 when an edition sits in
# `generating` or `sending` for more than three hours.
resource "aws_cloudwatch_metric_alarm" "edition_stuck" {
  alarm_name          = "argon-prod-edition-stuck"
  alarm_description   = "An edition has been generating or sending for more than three hours."
  namespace           = "Argon"
  metric_name         = local.api_log_metrics.edition_stuck.metric
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

# The API could not warn the owners by e-mail (step 2): the alert has to come from here.
resource "aws_cloudwatch_metric_alarm" "owner_alert_skipped" {
  alarm_name          = "argon-prod-owner-alert-skipped"
  alarm_description   = "The API skipped an owner alert; whatever it was about is unreported by e-mail."
  namespace           = "Argon"
  metric_name         = local.api_log_metrics.owner_alert_skipped.metric
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

# ---- Instance -----------------------------------------------------------------------------

# A failed system status check (hardware or hypervisor) moves the instance to healthy hardware,
# keeping its id, volume, private address and Elastic IP. Docker and the timers come back on
# boot; the Compose stack is `restart: unless-stopped`.
resource "aws_cloudwatch_metric_alarm" "ec2_system_check" {
  alarm_name          = "argon-ec2-system-check-failed"
  alarm_description   = "System status check failed on the Argon instance; EC2 recovery was requested."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_System"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"

  dimensions = {
    InstanceId = aws_instance.argon.id
  }

  alarm_actions = concat(
    ["arn:aws:automate:${var.region}:ec2:recover"],
    local.alarm_actions,
  )
  ok_actions = local.alarm_actions
}

# ---- External health check ----------------------------------------------------------------

# Route 53 probes /health from several regions every 30 s. The DNS zone is in another account,
# but a health check does not need the zone, only the hostname.
resource "aws_route53_health_check" "api" {
  fqdn              = var.api_health_check_fqdn
  port              = 443
  type              = "HTTPS"
  resource_path     = "/health"
  request_interval  = 30
  failure_threshold = 3
  enable_sni        = true

  tags = {
    Name = "argon-api-health"
  }
}

# HealthCheckStatus is 1 while healthy. Missing data also alarms: a check that stops reporting
# is not a check. Expect a few minutes in ALARM right after creation, until the first samples.
resource "aws_cloudwatch_metric_alarm" "api_health" {
  provider = aws.us_east_1

  alarm_name          = "argon-prod-api-health"
  alarm_description   = "https://${var.api_health_check_fqdn}/health failed from outside for three minutes."
  namespace           = "AWS/Route53"
  metric_name         = "HealthCheckStatus"
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  dimensions = {
    HealthCheckId = aws_route53_health_check.api.id
  }

  alarm_actions = [aws_sns_topic.alerts_us_east_1.arn]
  ok_actions    = [aws_sns_topic.alerts_us_east_1.arn]
}
