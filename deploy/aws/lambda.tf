# The API image as Lambda functions, two per environment, in place of the EC2 containers:
#
# - argon-<env>-api answers HTTP: the subscriber routes the site and the mail providers call, and
#   the operator's routes. It has a function URL (CloudFront goes in front of it next).
# - argon-<env>-jobs runs the day's jobs by name (src/pipeline/jobs.controller.ts). It has no URL:
#   only an invocation IAM allows reaches it — EventBridge Scheduler, or an operator.
#
# Both run the same server as the EC2: the Lambda Web Adapter in the image (apps/api/Dockerfile)
# turns each invocation into a request to it on port 3001, and dist/lambda/main.js reads
# /argon/<env>/ from the Parameter Store before the app loads. The function's own variables below
# win over the store: no internal clock, no Studio, and the jobs route only on the jobs function.
#
# The image tag is set once, at creation; after that the deploy workflow moves the functions to
# each new image and Terraform leaves the tag alone.

variable "lambda_environments" {
  description = "Environments that have their API running as Lambda functions."
  type        = list(string)
  default     = ["lab"]
}

variable "lambda_bootstrap_tag" {
  description = "Tag of argon/api a new function is created with. It must carry the Lambda Web Adapter."
  type        = string
  default     = ""
}

locals {
  lambda_functions = merge([
    for env in var.lambda_environments : {
      "${env}-api" = { env = env, jobs = false, timeout = 30 }
      # The generation takes about a minute and a half today; 15 minutes is the Lambda ceiling.
      "${env}-jobs" = { env = env, jobs = true, timeout = 900 }
    }
  ]...)
}

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# One role per environment: a function reads its own environment's parameters and nobody else's.
resource "aws_iam_role" "lambda" {
  for_each = toset(var.lambda_environments)

  name               = "argon-lambda-${each.key}"
  description        = "Argon ${each.key} API on Lambda: Parameter Store /argon/${each.key}/*, its log group"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "lambda" {
  for_each = toset(var.lambda_environments)

  # GetParametersByPath is authorized on the path itself; the SecureStrings use the AWS managed
  # key, which lets any principal allowed by IAM decrypt through the Parameter Store.
  statement {
    sid     = "LeParametrosDoAmbiente"
    effect  = "Allow"
    actions = ["ssm:GetParametersByPath"]
    resources = [
      "arn:aws:ssm:${var.region}:${var.account_id}:parameter/argon/${each.key}",
      "arn:aws:ssm:${var.region}:${var.account_id}:parameter/argon/${each.key}/*",
    ]
  }

  # The API's log group, the one the EC2 container writes to and the metric filters read.
  statement {
    sid       = "EscreveNoGrupoDeLogsDaApi"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.argon["/argon/${each.key}/api"].arn}:*"]
  }
}

resource "aws_iam_role_policy" "lambda" {
  for_each = toset(var.lambda_environments)

  name   = "argon-lambda-${each.key}"
  role   = aws_iam_role.lambda[each.key].name
  policy = data.aws_iam_policy_document.lambda[each.key].json
}

resource "aws_lambda_function" "argon" {
  for_each = local.lambda_functions

  function_name = "argon-${each.key}"
  role          = aws_iam_role.lambda[each.value.env].arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.app["api"].repository_url}:${var.lambda_bootstrap_tag}"
  architectures = ["arm64"]
  memory_size   = 1024
  timeout       = each.value.timeout

  image_config {
    command = ["node", "dist/lambda/main.js"]
  }

  environment {
    variables = {
      ARGON_SSM_PATH    = "/argon/${each.value.env}/"
      ARGON_ENV         = each.value.env
      NODE_ENV          = "production"
      SCHEDULER_ENABLED = "false"
      STUDIO_ENABLED    = "false"
      JOBS_ENABLED      = tostring(each.value.jobs)
      # The adapter waits for /health/live, which does not touch the database, before the first
      # invocation. Async init keeps a slow first boot from counting against the 10 s init limit.
      AWS_LWA_PORT                 = "3001"
      AWS_LWA_READINESS_CHECK_PATH = "/health/live"
      AWS_LWA_ASYNC_INIT           = "true"
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.argon["/argon/${each.value.env}/api"].name
  }

  lifecycle {
    ignore_changes = [image_uri]

    precondition {
      condition     = var.lambda_bootstrap_tag != ""
      error_message = "lambda_bootstrap_tag must name an argon/api image with the Lambda Web Adapter."
    }
  }

  depends_on = [aws_iam_role_policy.lambda]
}

# The HTTP door of the API function. Open, as the API host is today: the routes check the internal
# secret themselves, and the public ones are public on purpose.
resource "aws_lambda_function_url" "api" {
  for_each = toset(var.lambda_environments)

  function_name      = aws_lambda_function.argon["${each.key}-api"].function_name
  authorization_type = "NONE"
}

# A URL with no auth still needs a resource policy that lets anyone call it, and since October 2025
# that takes two permissions: lambda:InvokeFunctionUrl, and lambda:InvokeFunction restricted to
# calls that come through the URL (invoked_via_function_url, provider 6.28+). Neither allows a
# direct invocation of the function.
resource "aws_lambda_permission" "api_url" {
  for_each = toset(var.lambda_environments)

  statement_id           = "UrlPublica"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.argon["${each.key}-api"].function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "api_url_invoke" {
  for_each = toset(var.lambda_environments)

  statement_id             = "UrlPublicaInvoca"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.argon["${each.key}-api"].function_name
  principal                = "*"
  invoked_via_function_url = true
}

# Lambda pulls the image with its own service principal, limited to the Argon functions.
data "aws_iam_policy_document" "ecr_api_lambda" {
  statement {
    sid     = "LambdaPuxaAImagemDaApi"
    effect  = "Allow"
    actions = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "aws:sourceArn"
      values   = ["arn:aws:lambda:${var.region}:${var.account_id}:function:argon-*"]
    }
  }
}

resource "aws_ecr_repository_policy" "api_lambda" {
  repository = aws_ecr_repository.app["api"].name
  policy     = data.aws_iam_policy_document.ecr_api_lambda.json
}

output "lambda_api_urls" {
  description = "Function URL of each environment's API function."
  value       = { for env, url in aws_lambda_function_url.api : env => url.function_url }
}
