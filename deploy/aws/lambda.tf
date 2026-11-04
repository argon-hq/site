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
  default     = ["lab", "prod"]
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
    variables = merge({
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
      },
      # Only the API function sits behind CloudFront (apps/api/src/net/cloudfront.ts).
      each.value.jobs ? {} : { ORIGIN_VERIFY_SECRET = random_password.origin_verify[each.value.env].result },
    )
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

# ---- Keep-warm ------------------------------------------------------------------------------
# A cold start of the API function takes 3.5–5 s, almost all of it Node loading the app (Mastra,
# Effect, react-email, Nest); the first subscriber after a quiet hour would wait that long. Every
# 5 minutes EventBridge Scheduler sends the function a GET /health/live, shaped like a function URL
# request so the adapter routes it as HTTP. That route does not touch the database, so Neon still
# suspends. About 8,600 invocations a month of a few milliseconds each, inside the free tier.

data "aws_iam_policy_document" "scheduler_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.account_id]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "argon-scheduler"
  description        = "EventBridge Scheduler: invokes the Argon Lambda functions"
  assume_role_policy = data.aws_iam_policy_document.scheduler_trust.json
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    sid       = "InvocaAsFuncoesDoArgon"
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [for f in aws_lambda_function.argon : f.arn]
  }
}

resource "aws_iam_role_policy" "scheduler" {
  name   = "argon-scheduler"
  role   = aws_iam_role.scheduler.name
  policy = data.aws_iam_policy_document.scheduler.json
}

resource "aws_scheduler_schedule" "keep_warm" {
  for_each = toset(var.lambda_environments)

  name                = "argon-${each.key}-api-keep-warm"
  schedule_expression = "rate(5 minutes)"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.argon["${each.key}-api"].arn
    role_arn = aws_iam_role.scheduler.arn

    input = jsonencode({
      version        = "2.0"
      routeKey       = "$default"
      rawPath        = "/health/live"
      rawQueryString = ""
      headers        = { "user-agent" = "argon-keep-warm" }
      requestContext = {
        accountId    = "anonymous"
        apiId        = "keep-warm"
        domainName   = "keep-warm"
        domainPrefix = "keep-warm"
        http = {
          method    = "GET"
          path      = "/health/live"
          protocol  = "HTTP/1.1"
          sourceIp  = "127.0.0.1"
          userAgent = "argon-keep-warm"
        }
        requestId = "keep-warm"
        routeKey  = "$default"
        stage     = "$default"
        time      = "01/Jan/2026:00:00:00 +0000"
        timeEpoch = 0
      }
      isBase64Encoded = false
    })

    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}

# ---- The day's jobs -------------------------------------------------------------------------
# The same hours as the @Cron decorators (apps/api/src/pipeline/run.ts and retention.ts), in São
# Paulo time, each invoking the jobs function with its name. A schedule is created for every
# Lambda environment and only runs where lambda_jobs_enabled says so: on the day an environment
# moves here, its EC2 clock goes off (SCHEDULER_ENABLED) and these go on, never both.

variable "lambda_jobs_enabled" {
  description = "Environments whose day's jobs EventBridge Scheduler runs (the rest are created disabled)."
  type        = list(string)
  default     = []
}

locals {
  lambda_jobs = {
    "retention"      = "cron(0 4 * * ? *)"
    "edition"        = "cron(30 5 ? * MON-SAT *)"
    "send"           = "cron(0 7 ? * MON-SAT *)"
    "watch"          = "cron(0 8 ? * MON-SAT *)"
    "sunday-edition" = "cron(30 5 ? * SUN *)"
    "sunday-send"    = "cron(0 7 ? * SUN *)"
  }

  lambda_job_schedules = merge([
    for env in var.lambda_environments : {
      for job, cron in local.lambda_jobs : "${env}-${job}" => { env = env, job = job, cron = cron }
    }
  ]...)
}

resource "aws_scheduler_schedule" "jobs" {
  for_each = local.lambda_job_schedules

  name                         = "argon-${each.key}"
  schedule_expression          = each.value.cron
  schedule_expression_timezone = "America/Sao_Paulo"
  state                        = contains(var.lambda_jobs_enabled, each.value.env) ? "ENABLED" : "DISABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.argon["${each.value.env}-jobs"].arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ job = each.value.job })

    # A job that failed has already alerted the owners; running it again is for a person to decide.
    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}

# The scheduler invokes asynchronously, and Lambda retries a failed asynchronous invocation twice by
# default: a send cut by the timeout would start again on its own. Never here.
resource "aws_lambda_function_event_invoke_config" "jobs" {
  for_each = toset(var.lambda_environments)

  function_name          = aws_lambda_function.argon["${each.key}-jobs"].function_name
  maximum_retry_attempts = 0
}
