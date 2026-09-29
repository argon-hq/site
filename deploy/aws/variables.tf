variable "region" {
  description = "Region of every regional resource."
  type        = string
  default     = "sa-east-1"
}

variable "account_id" {
  description = "Account this configuration is allowed to run against."
  type        = string
  default     = "382597877834"
}

variable "availability_zone" {
  description = "AZ of the default subnet the instance is placed in."
  type        = string
  default     = "sa-east-1b"
}

variable "instance_type" {
  description = "EC2 instance type. ARM (Graviton): the images and the AMI are arm64."
  type        = string
  default     = "t4g.small"
}

variable "root_volume_size" {
  description = "Root volume size in GiB."
  type        = number
  default     = 16
}

variable "log_retention_days" {
  description = "Retention of every /argon/* log group."
  type        = number
  default     = 30
}

variable "github_repository" {
  description = "GitHub repository allowed to assume the deploy role, as owner/name."
  type        = string
  default     = "argon-hq/site"
}

variable "github_oidc_subjects" {
  description = <<-EOT
    Extra `sub` claims accepted by the deploy role's trust policy, besides `repo:<repository>:*`.
    The existing role also accepts the id-based form GitHub emits for renamed repositories.
  EOT
  type        = list(string)
  default     = ["repo:argon-hq@313578398/site@1366636241:*"]
}

variable "api_health_check_fqdn" {
  description = "Host of the production API checked by Route 53."
  type        = string
  default     = "api.argon.eduardofockink.com"
}

variable "alert_email" {
  description = "Address subscribed to the alert topics. Each subscription must be confirmed by hand."
  type        = string
}

variable "budget_limit_usd" {
  description = "Monthly cost budget, in USD."
  type        = number
  default     = 30
}

variable "budget_emails" {
  description = "Addresses that receive the 80% and 100% budget notifications."
  type        = list(string)
}
