# Everything that already existed in the account on 2026-09-24, so the first plan adopts it
# instead of creating a copy. Ids were read from the account; nothing was changed to get them.
# Once the first apply has run, this file can be deleted — the state remembers.
#
# Not listed, because they do not exist yet: the SNS topics, the /argon/prod/api log group, the
# metric filters, the alarms and the Route 53 health check.

# ---- EC2 ----------------------------------------------------------------------------------

import {
  to = aws_instance.argon
  id = "i-00296133cc8e8093d"
}

import {
  to = aws_eip.argon
  id = "eipalloc-0a2f0c3de3bf7be13"
}

import {
  to = aws_eip_association.argon
  id = "eipassoc-08a02c0bbcfed5460"
}

import {
  to = aws_security_group.web
  id = "sg-0768581b67b050a67"
}

import {
  to = aws_vpc_security_group_ingress_rule.web_http
  id = "sgr-06284754049f4d133"
}

import {
  to = aws_vpc_security_group_ingress_rule.web_https
  id = "sgr-0f52ebfac2cf386d5"
}

import {
  to = aws_vpc_security_group_egress_rule.web_all
  id = "sgr-018648aad15b3479a"
}

import {
  to = aws_security_group.db
  id = "sg-003868d936307df4b"
}

import {
  to = aws_vpc_security_group_ingress_rule.db_postgres
  id = "sgr-065e48ae46e95250b"
}

import {
  to = aws_vpc_security_group_egress_rule.db_all
  id = "sgr-058f8e2f3c8283657"
}

# ---- IAM ----------------------------------------------------------------------------------

import {
  to = aws_iam_role.ec2
  id = "argon-ec2"
}

import {
  to = aws_iam_instance_profile.ec2
  id = "argon-ec2"
}

import {
  to = aws_iam_role_policy_attachment.ec2_ssm
  id = "argon-ec2/arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

import {
  to = aws_iam_role_policy_attachment.ec2_ecr
  id = "argon-ec2/arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

import {
  to = aws_iam_role_policy.ec2_backups
  id = "argon-ec2:argon-backups"
}

import {
  to = aws_iam_role_policy.ec2_params_and_logs
  id = "argon-ec2:argon-params-and-logs"
}

import {
  to = aws_iam_openid_connect_provider.github
  id = "arn:aws:iam::382597877834:oidc-provider/token.actions.githubusercontent.com"
}

import {
  to = aws_iam_role.github_deploy
  id = "argon-github-deploy"
}

import {
  to = aws_iam_role_policy.github_deploy
  id = "argon-github-deploy:argon-deploy"
}

# ---- ECR ----------------------------------------------------------------------------------

import {
  for_each = toset(["web", "api"])
  to       = aws_ecr_repository.app[each.key]
  id       = "argon/${each.key}"
}

import {
  for_each = toset(["web", "api"])
  to       = aws_ecr_lifecycle_policy.app[each.key]
  id       = "argon/${each.key}"
}

# ---- S3 -----------------------------------------------------------------------------------

import {
  to = aws_s3_bucket.backups
  id = "argon-db-backups-382597877834"
}

import {
  to = aws_s3_bucket_public_access_block.backups
  id = "argon-db-backups-382597877834"
}

import {
  to = aws_s3_bucket_ownership_controls.backups
  id = "argon-db-backups-382597877834"
}

import {
  to = aws_s3_bucket_server_side_encryption_configuration.backups
  id = "argon-db-backups-382597877834"
}

import {
  to = aws_s3_bucket_versioning.backups
  id = "argon-db-backups-382597877834"
}

import {
  to = aws_s3_bucket_lifecycle_configuration.backups
  id = "argon-db-backups-382597877834"
}

# ---- Budget -------------------------------------------------------------------------------

import {
  to = aws_budgets_budget.monthly
  id = "382597877834:argon-mensal"
}

# ---- Logs ---------------------------------------------------------------------------------

# /argon/prod/api is missing from this list on purpose: it did not exist on 2026-09-24. If the
# awslogs driver creates it before the first apply, add it here.
import {
  for_each = toset([
    "/argon/prod/web",
    "/argon/dev/web",
    "/argon/dev/api",
    "/argon/lab/web",
    "/argon/lab/api",
    "/argon/postgres",
  ])
  to = aws_cloudwatch_log_group.argon[each.key]
  id = each.key
}

# ---- Parameter Store ----------------------------------------------------------------------

import {
  for_each = local.parameters
  to       = aws_ssm_parameter.argon[each.key]
  id       = each.key
}
