output "instance_id" {
  description = "EC2 instance; goes into the AWS_INSTANCE_ID secret on GitHub."
  value       = aws_instance.argon.id
}

output "public_ip" {
  description = "Elastic IP the DNS records (in the other account) point to."
  value       = aws_eip.argon.public_ip
}

output "deploy_role_arn" {
  description = "Role GitHub Actions assumes; goes into the AWS_DEPLOY_ROLE_ARN secret on GitHub."
  value       = aws_iam_role.github_deploy.arn
}

output "ecr_repository_urls" {
  description = "Image repositories, by app."
  value       = { for app, repo in aws_ecr_repository.app : app => repo.repository_url }
}

output "backup_bucket" {
  description = "Bucket of the nightly dumps; goes into ARGON_BACKUP_BUCKET in /opt/argon/.env."
  value       = aws_s3_bucket.backups.bucket
}

output "alerts_topic_arn" {
  description = "SNS topic every alarm publishes to (sa-east-1)."
  value       = aws_sns_topic.alerts.arn
}

output "api_health_check_id" {
  description = "Route 53 health check on the production API."
  value       = aws_route53_health_check.api.id
}

output "public_bucket" {
  description = "Bucket of the public files; the deploy workflow writes apps/web/public into <env>/."
  value       = aws_s3_bucket.public.bucket
}

output "public_base_url" {
  description = "Base URL of the public files; append <env>/<path under apps/web/public>."
  value       = "https://${aws_s3_bucket.public.bucket}.s3.${var.region}.amazonaws.com"
}
