# ECS Fargate cluster running two services (API, admin-web) behind one
# public ALB, path-routed: "/api/*" -> API service, everything else ->
# admin-web service. Each service's task definition pulls its secrets
# (DB URL, Redis URL, JWT keys, etc.) directly from Secrets Manager at
# container start -- no secret value ever appears in the task definition
# itself or in `terraform plan` output.

resource "aws_ecs_cluster" "this" {
  name = "${var.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.name_prefix}/api"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_cloudwatch_log_group" "admin_web" {
  name              = "/ecs/${var.name_prefix}/admin-web"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

# ── IAM ──────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Execution role: what ECS itself needs (pull the image, write logs, read
# the secrets referenced in the task definition's `secrets` block).
resource "aws_iam_role" "execution" {
  name               = "${var.name_prefix}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = var.secret_arns
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "${var.name_prefix}-ecs-execution-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# Task role: what the *application code inside the container* is allowed
# to do at runtime (S3 read/write for file storage + PDF reports, KMS
# encrypt/decrypt for envelope encryption). Least-privilege: no broader
# S3/KMS access than the two buckets and one key this app actually uses.
resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
  tags               = var.tags
}

data "aws_iam_policy_document" "task_permissions" {
  statement {
    sid       = "S3FileStorage"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${var.files_bucket_arn}/*"]
  }
  statement {
    sid       = "S3ListBucket"
    actions   = ["s3:ListBucket"]
    resources = [var.files_bucket_arn]
  }
  statement {
    sid       = "KmsEnvelopeEncryption"
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"]
    resources = [var.kms_key_arn]
  }
}

resource "aws_iam_role_policy" "task_permissions" {
  name   = "${var.name_prefix}-ecs-task-permissions"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_permissions.json
}

# ── Load balancer ────────────────────────────────────────────────────────

resource "aws_lb" "this" {
  name               = "${var.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.alb_security_group_id]
  subnets            = var.public_subnet_ids

  tags = var.tags
}

resource "aws_lb_target_group" "api" {
  name        = "${var.name_prefix}-api-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/api/v1/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    matcher             = "200"
  }

  tags = var.tags
}

resource "aws_lb_target_group" "admin_web" {
  name        = "${var.name_prefix}-web-tg"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/login"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    matcher             = "200"
  }

  tags = var.tags
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  # Redirects to HTTPS once a certificate is attached (var.certificate_arn
  # set); until then, serves admin-web directly over HTTP for a bootstrap
  # deploy with no custom domain yet.
  dynamic "default_action" {
    for_each = var.certificate_arn == null ? [1] : []
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.admin_web.arn
    }
  }
  dynamic "default_action" {
    for_each = var.certificate_arn == null ? [] : [1]
    content {
      type = "redirect"
      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }
}

resource "aws_lb_listener" "https" {
  count             = var.certificate_arn == null ? 0 : 1
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.admin_web.arn
  }
}

resource "aws_lb_listener_rule" "api_path" {
  for_each     = var.certificate_arn == null ? { http = aws_lb_listener.http.arn } : { https = aws_lb_listener.https[0].arn }
  listener_arn = each.value
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }
}

# ── API service ──────────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name_prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name         = "api"
    image        = var.api_image
    essential    = true
    portMappings = [{ containerPort = 3000, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV", value = var.environment },
      { name = "PORT", value = "3000" },
      # APP_ENV drives the dev-login safety check (see apps/api/src/common/config/app-environment.ts).
      # Dev login stays off on every AWS environment; the API refuses to boot with
      # APP_ENV=production and DEV_LOGIN_ENABLED=true.
      { name = "APP_ENV", value = var.environment == "dev" ? "development" : var.environment },
      { name = "DEV_LOGIN_ENABLED", value = "false" },
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = "${var.db_credentials_secret_arn}:url::" },
      { name = "REDIS_URL", valueFrom = "${var.redis_credentials_secret_arn}:url::" },
      { name = "JWT_ACCESS_SECRET", valueFrom = var.jwt_access_secret_arn },
      { name = "JWT_REFRESH_SECRET", valueFrom = var.jwt_refresh_secret_arn },
      { name = "LOCAL_ENCRYPTION_KEY_BASE64", valueFrom = var.encryption_key_secret_arn },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "api"
      }
    }
  }])

  tags = var.tags
}

resource "aws_ecs_service" "api" {
  name            = "${var.name_prefix}-api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [var.ecs_tasks_security_group_id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener.http]
  tags       = var.tags
}

resource "aws_appautoscaling_target" "api" {
  max_capacity       = var.api_max_count
  min_capacity       = var.api_desired_count
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "${var.name_prefix}-api-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value = 65
  }
}

# ── Admin web service ────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "admin_web" {
  family                   = "${var.name_prefix}-admin-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.admin_web_cpu
  memory                   = var.admin_web_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name         = "admin-web"
    image        = var.admin_web_image
    essential    = true
    portMappings = [{ containerPort = 3001, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV", value = var.environment },
      { name = "NEXT_PUBLIC_API_URL", value = var.public_api_url },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.admin_web.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "admin-web"
      }
    }
  }])

  tags = var.tags
}

resource "aws_ecs_service" "admin_web" {
  name            = "${var.name_prefix}-admin-web"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.admin_web.arn
  desired_count   = var.admin_web_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [var.ecs_tasks_security_group_id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.admin_web.arn
    container_name   = "admin-web"
    container_port   = 3001
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener.http]
  tags       = var.tags
}
