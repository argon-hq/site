# Free warnings (06/11/2026). GuardDuty was left out on purpose: it costs a few dollars a month
# after the 30-day trial, and the decision was not to pay for it yet.
#
# IAM Access Analyzer, external access: flags any resource (bucket, role, key) that something
# outside the account can reach. Free.
resource "aws_accessanalyzer_analyzer" "account" {
  analyzer_name = "argon-acesso-externo"
  type          = "ACCOUNT"
}

# Cost Anomaly Detection: the account already has the per-service monitor AWS creates by default
# (a second one is refused: "Limit exceeded on dimensional spend monitor creation"). Who gets its
# alerts is set in the console, Billing > Cost Anomaly Detection.
