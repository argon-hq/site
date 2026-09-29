# One instance in the default VPC, with a fixed public address. Docker Compose does the rest
# (../compose.yml); user data comes from ../bootstrap.sh.

data "aws_caller_identity" "current" {}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnet" "instance" {
  vpc_id            = data.aws_vpc.default.id
  availability_zone = var.availability_zone
  default_for_az    = true
}

# Latest Amazon Linux 2023 for arm64. Only used when an instance is created: the existing one
# keeps its AMI (see ignore_changes below), otherwise every AL2023 release would replace it.
data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

resource "aws_security_group" "web" {
  name        = "argon-web"
  description = "Argon web: 80/443"
  vpc_id      = data.aws_vpc.default.id
}

resource "aws_vpc_security_group_ingress_rule" "web_http" {
  security_group_id = aws_security_group.web.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "web_https" {
  security_group_id = aws_security_group.web.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "web_all" {
  security_group_id = aws_security_group.web.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# Left over from the RDS days: nothing is attached to it today. Kept because it exists and
# costs nothing; drop it together with the last RDS reference.
resource "aws_security_group" "db" {
  name        = "argon-db"
  description = "Argon db: 5432 from argon-web"
  vpc_id      = data.aws_vpc.default.id
}

resource "aws_vpc_security_group_ingress_rule" "db_postgres" {
  security_group_id            = aws_security_group.db.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.web.id
}

resource "aws_vpc_security_group_egress_rule" "db_all" {
  security_group_id = aws_security_group.db.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_instance" "argon" {
  # The data source marks every value sensitive; an AMI id is public, so show it in the plan.
  ami                    = nonsensitive(data.aws_ssm_parameter.al2023_arm64.value)
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnet.instance.id
  vpc_security_group_ids = [aws_security_group.web.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name
  user_data              = file("${path.module}/../bootstrap.sh")
  monitoring             = false

  # A t4g with unlimited credits, as created; the generation runs are short CPU bursts.
  credit_specification {
    cpu_credits = "unlimited"
  }

  # IMDSv2 only, and a hop limit of 1: nothing inside a container can reach the instance
  # credentials (the app makes no AWS calls; the awslogs driver runs in dockerd, on the host).
  # The running instance has a hop limit of 2 — applying this changes it in place.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    http_protocol_ipv6          = "disabled"
    instance_metadata_tags      = "disabled"
  }

  # gp3 at the baseline 3000 IOPS / 125 MiB/s. Not encrypted today; turning encryption on means
  # a new volume, so it is a deliberate change, not a default.
  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size
    delete_on_termination = true
  }

  private_dns_name_options {
    hostname_type                        = "ip-name"
    enable_resource_name_dns_a_record    = false
    enable_resource_name_dns_aaaa_record = false
  }

  maintenance_options {
    auto_recovery = "default"
  }

  tags = {
    Name = "argon"
  }

  lifecycle {
    # The AMI moves with every AL2023 release and would force a replacement. User data on the
    # instance is the first version of bootstrap.sh (without the timers, added by hand later);
    # a change here would stop and start the instance. Both are decided by hand, never by a plan.
    ignore_changes = [ami, user_data]
  }
}

resource "aws_eip" "argon" {
  domain = "vpc"

  tags = {
    Name = "argon"
  }
}

resource "aws_eip_association" "argon" {
  allocation_id = aws_eip.argon.id
  instance_id   = aws_instance.argon.id
}
