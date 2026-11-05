# Parameter Store: names and types only. Values are written by hand (`aws ssm put-parameter
# --overwrite`, see ../README.md) and ignored here, so a plan never proposes a secret and a
# tfvars never holds one. Terraform still reads the current value into the state on import and
# refresh: the state bucket is as sensitive as the parameters themselves.
#
# `/argon/rds/master_password` also exists. It is a leftover from the RDS instance and is not
# managed here; delete it by hand.

locals {
  # The variables every environment's functions load at boot (../README.md, "Variáveis"). The
  # switches the EC2 read from here (SCHEDULER_ENABLED, STUDIO_ENABLED) are the functions' own
  # environment now (lambda.tf), which wins over the Parameter Store.
  common_secure = ["ANTHROPIC_API_KEY", "DATABASE_URL", "INTERNAL_API_SECRET", "RESEND_API_KEY", "UNSUBSCRIBE_TOKEN_SECRET"]
  common_plain  = ["API_ORIGIN", "MAIL_FROM", "MAIL_TRANSPORT", "WEB_ORIGIN"]

  parameters = merge([
    for env in local.environments : merge(
      { for name in local.common_secure : "/argon/${env}/${name}" => "SecureString" },
      { for name in local.common_plain : "/argon/${env}/${name}" => "String" },
    )
  ]...)
}

resource "aws_ssm_parameter" "argon" {
  for_each = local.parameters

  name = each.key
  type = each.value

  # Placeholder for a fresh account only. After that the value belongs to the operator.
  value = "CHANGE-ME"

  lifecycle {
    ignore_changes = [value]
  }
}
