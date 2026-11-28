# One repository per image. Tags are the commit SHA, so `latest` never matters here.

resource "aws_ecr_repository" "app" {
  for_each = toset(["api"])

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

# Five images per repository, roughly the last five deploys, is enough to roll back with. The image
# each environment runs keeps its environment's tag (prod, dev, lab; the deploy moves it), and the
# first rule never expires those: a Lambda function pins the image it runs, and an image deleted
# under it breaks the function, however long ago its environment was last deployed. Tags are
# commit SHAs otherwise, hex only, so those three prefixes match nothing else.
resource "aws_ecr_lifecycle_policy" "app" {
  for_each = aws_ecr_repository.app

  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "keep what each environment runs"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["prod", "dev", "lab"]
          countType     = "imageCountMoreThan"
          countNumber   = 3
        }
        action = {
          type = "expire"
        }
      },
      {
        rulePriority = 2
        description  = "keep last 5"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 5
        }
        action = {
          type = "expire"
        }
      },
    ]
  })
}
