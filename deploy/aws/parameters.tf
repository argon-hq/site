# Parameter Store: names and types only. Values are written by hand (`aws ssm put-parameter
# --overwrite`, see ../README.md) and ignored here, so a plan never proposes a secret and a
# tfvars never holds one. Terraform still reads the current value into the state on import and
# refresh: the state bucket is as sensitive as the parameters themselves.
#
# `/argon/rds/master_password` also exists. It is a leftover from the RDS instance and is not
# managed here; delete it by hand.

locals {
  # The eight variables every environment expects (../README.md, "Variáveis").
  common_secure = ["ANTHROPIC_API_KEY", "DATABASE_URL", "INTERNAL_API_SECRET", "RESEND_API_KEY"]
  common_plain  = ["API_ORIGIN", "API_URL", "MAIL_TRANSPORT", "WEB_ORIGIN"]

  # Optional ones, per environment, present where they were set. Every environment in
  # local.environments (logs.tf) must have an entry, even an empty one.
  extra_plain = {
    prod = []
    dev  = ["SCHEDULER_ENABLED", "STUDIO_ENABLED"]
    lab  = ["STUDIO_ENABLED"]
  }

  environment_parameters = merge([
    for env, extras in local.extra_plain : merge(
      { for name in local.common_secure : "/argon/${env}/${name}" => "SecureString" },
      { for name in concat(local.common_plain, extras) : "/argon/${env}/${name}" => "String" },
    )
  ]...)

  parameters = merge(local.environment_parameters, {
    # Superuser password of the Postgres container; provision-db.sh reads it on every deploy.
    "/argon/postgres/POSTGRES_PASSWORD" = "SecureString"
  })
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
