# Every alarm, the deploy workflow's failure step and the backup unit's OnFailure publish here.
# Neither topic exists yet: the first apply creates both.
#
# An e-mail subscription is only live after the recipient clicks the confirmation link. The
# provider waits a couple of minutes for that during apply; if it gives up, confirm the e-mail
# and run apply again — see README.md, "Confirmar as assinaturas".

resource "aws_sns_topic" "alerts" {
  name = "argon-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# CloudWatch only notifies topics in its own region, and the Route 53 alarm lives in us-east-1.
resource "aws_sns_topic" "alerts_us_east_1" {
  provider = aws.us_east_1

  name = "argon-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email_us_east_1" {
  provider = aws.us_east_1

  topic_arn = aws_sns_topic.alerts_us_east_1.arn
  protocol  = "email"
  endpoint  = var.alert_email
}
