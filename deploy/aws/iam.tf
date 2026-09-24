# Two roles: the instance's, and the one GitHub Actions assumes through OIDC to deploy.

# ---- Instance role -------------------------------------------------------------------------

data "aws_iam_policy_document" "ec2_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ec2" {
  name               = "argon-ec2"
  description        = "Argon EC2: SSM, ECR pull, Parameter Store /argon/*, CloudWatch logs"
  assume_role_policy = data.aws_iam_policy_document.ec2_trust.json
}

resource "aws_iam_instance_profile" "ec2" {
  name = "argon-ec2"
  role = aws_iam_role.ec2.name
}

# Session Manager (no SSH) and image pulls.
resource "aws_iam_role_policy_attachment" "ec2_ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "ec2_ecr" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

# backup-db.sh writes the dumps; it never lists or reads them back.
data "aws_iam_policy_document" "ec2_backups" {
  statement {
    sid       = "EscreveDumpsDoPostgres"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.backups.arn}/postgres/*"]
  }
}

resource "aws_iam_role_policy" "ec2_backups" {
  name   = "argon-backups"
  role   = aws_iam_role.ec2.name
  policy = data.aws_iam_policy_document.ec2_backups.json
}

# deploy.sh reads /argon/<env>/* to build the env files; the awslogs driver writes /argon/*.
data "aws_iam_policy_document" "ec2_params_and_logs" {
  statement {
    effect = "Allow"
    actions = [
      "ssm:GetParametersByPath",
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:PutParameter",
      "ssm:AddTagsToResource",
    ]
    resources = ["arn:aws:ssm:${var.region}:${var.account_id}:parameter/argon/*"]
  }

  statement {
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:Encrypt"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.region}.amazonaws.com"]
    }
  }

  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams",
      "logs:PutRetentionPolicy",
    ]
    resources = ["arn:aws:logs:${var.region}:${var.account_id}:log-group:/argon/*"]
  }

  statement {
    effect    = "Allow"
    actions   = ["sts:GetCallerIdentity"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "ec2_params_and_logs" {
  name   = "argon-params-and-logs"
  role   = aws_iam_role.ec2.name
  policy = data.aws_iam_policy_document.ec2_params_and_logs.json
}

# ---- GitHub Actions deploy role ------------------------------------------------------------

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_policy_document" "github_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = concat(["repo:${var.github_repository}:*"], var.github_oidc_subjects)
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "argon-github-deploy"
  description        = "GitHub Actions deploy for ${var.github_repository}"
  assume_role_policy = data.aws_iam_policy_document.github_trust.json
}

# Push images, then run deploy.sh on the instance through SSM Run Command.
data "aws_iam_policy_document" "github_deploy" {
  statement {
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:DescribeImages",
    ]
    resources = ["arn:aws:ecr:${var.region}:${var.account_id}:repository/argon/*"]
  }

  # Only instances tagged Project=argon can receive the command.
  statement {
    effect  = "Allow"
    actions = ["ssm:SendCommand"]
    resources = [
      "arn:aws:ssm:${var.region}::document/AWS-RunShellScript",
      "arn:aws:ec2:${var.region}:${var.account_id}:instance/*",
    ]

    condition {
      test     = "StringEquals"
      variable = "ssm:resourceTag/Project"
      values   = ["argon"]
    }
  }

  statement {
    effect    = "Allow"
    actions   = ["ssm:SendCommand"]
    resources = ["arn:aws:ssm:${var.region}::document/AWS-RunShellScript"]
  }

  statement {
    effect = "Allow"
    actions = [
      "ssm:GetCommandInvocation",
      "ssm:ListCommands",
      "ssm:ListCommandInvocations",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "argon-deploy"
  role   = aws_iam_role.github_deploy.name
  policy = data.aws_iam_policy_document.github_deploy.json
}
