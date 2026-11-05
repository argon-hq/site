# Every alarm and the deploy workflow's failure step publish here. The jobs' own failures mail the
# owners directly (apps/api/src/pipeline/owner-alert.ts).
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
