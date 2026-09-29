# One repository per image. Tags are the commit SHA, so `latest` never matters here.

resource "aws_ecr_repository" "app" {
  for_each = toset(["web", "api"])

  name                 = "argon/${each.key}"
  image_tag_mutability = "MUTABLE"

  # Off today. Step 15 of the review plan turns it on; flip it here, not in the console.
  image_scanning_configuration {
    scan_on_push = false
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

# Ten images per repository, roughly the last ten deploys, is enough to roll back with.
resource "aws_ecr_lifecycle_policy" "app" {
  for_each = aws_ecr_repository.app

  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "keep last 10"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      },
    ]
  })
}
