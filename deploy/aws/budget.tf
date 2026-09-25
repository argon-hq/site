# Monthly cost budget with e-mail at 80% and 100% of the limit. Budgets are global; the
# provider talks to us-east-1 for them on its own.

resource "aws_budgets_budget" "monthly" {
  name        = "argon-mensal"
  budget_type = "COST"
  # The API stores one decimal place; keep the same form so the plan stays quiet.
  limit_amount = format("%.1f", var.budget_limit_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # First full month of the account; the end is the AWS default for an open-ended budget.
  time_period_start = "2026-09-01_00:00"
  time_period_end   = "2087-06-15_00:00"

  cost_types {
    include_credit             = true
    include_discount           = true
    include_other_subscription = true
    include_recurring          = true
    include_refund             = true
    include_subscription       = true
    include_support            = true
    include_tax                = true
    include_upfront            = true
    use_amortized              = false
    use_blended                = false
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_emails
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_emails
  }
}
