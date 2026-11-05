# The role GitHub Actions assumes through OIDC to deploy.

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

# The bucket backend.tf points at. A backend block cannot read locals, so the name is repeated.
locals {
  state_bucket = "argon-terraform-state-${var.account_id}"
}

# Push the API image, run the migrations and move the functions to it (lambda.tf), publish the
# static site and apps/web/public, and invalidate the site's distribution.
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

  # The static site (deploy/aws/site_cdn.tf): read the two origins it is built with, sync the files
  # to the site bucket and invalidate the distribution.
  statement {
    sid       = "LeAsOrigensDoSite"
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = [for env in ["prod", "dev", "lab"] : "arn:aws:ssm:${var.region}:${var.account_id}:parameter/argon/${env}/*_ORIGIN"]
  }

  statement {
    sid       = "PublicaOSite"
    effect    = "Allow"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
  }

  statement {
    sid       = "ListaOSite"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.site.arn]
  }

  statement {
    sid       = "InvalidaOSite"
    effect    = "Allow"
    actions   = ["cloudfront:ListDistributions", "cloudfront:CreateInvalidation"]
    resources = ["*"]
  }

  # The API functions follow each deploy to the image it just pushed (deploy/aws/lambda.tf).
  statement {
    sid       = "AtualizaAsFuncoesDaApi"
    effect    = "Allow"
    actions   = ["lambda:UpdateFunctionCode", "lambda:GetFunction", "lambda:GetFunctionConfiguration"]
    resources = ["arn:aws:lambda:${var.region}:${var.account_id}:function:argon-*"]
  }

  # The deploy runs the migrations through the jobs function before the API function moves
  # (.github/workflows/deploy.yml, apps/api/src/pipeline/migrate.ts). Only the jobs functions.
  statement {
    sid       = "RodaAsMigrationsNaFuncaoDeJobs"
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = ["arn:aws:lambda:${var.region}:${var.account_id}:function:argon-*-jobs"]
  }

  # The ./public-assets root writes apps/web/public into the public bucket, one prefix per
  # environment. Tagging comes from the provider's default_tags on every object.
  statement {
    sid       = "ListaArquivosPublicos"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.public.arn]
  }

  statement {
    sid    = "PublicaArquivosPublicos"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:GetObjectTagging",
      "s3:PutObjectTagging",
    ]
    resources = ["${aws_s3_bucket.public.arn}/*"]
  }

  # Its state sits in the state bucket under public-assets/, and that is all of the state bucket
  # this role sees: the main state (site/) holds parameter values and stays out of reach.
  statement {
    sid       = "ListaEstadoDosArquivosPublicos"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${local.state_bucket}"]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["public-assets/*"]
    }
  }

  statement {
    sid       = "EstadoDosArquivosPublicos"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["arn:aws:s3:::${local.state_bucket}/public-assets/*"]
  }

  # The workflow's failure step tells the alerts topic that a deploy went red; without this the
  # alert itself fails and a red deploy reaches only whoever is watching the Actions tab.
  statement {
    sid       = "AvisaDeployComFalha"
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "argon-deploy"
  role   = aws_iam_role.github_deploy.name
  policy = data.aws_iam_policy_document.github_deploy.json
}
