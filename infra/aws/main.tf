terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# State / backend: intentionally NOT configured (local state). Before a real apply, add an
# S3 (or Terraform Cloud) backend with one state per environment, e.g.
#   terraform init -backend-config="key=workshop-registration/<environment>/terraform.tfstate"
# or use one workspace per environment. Never share state between environments.

locals {
  # Resource name, unique per environment (e.g. workshop-registration-staging).
  full_name = "${var.name}-${var.environment}"
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "workshop-registration"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${local.full_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_apigatewayv2_api" "this" {
  name          = local.full_name
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = var.cors_allowed_origins
    allow_methods = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
    allow_headers = ["Authorization", "Content-Type"]
    max_age       = 600
  }
}

# Pass-through to the ECS/ALB (or any HTTP) origin. The backend serves everything under
# /api, so the prefix is re-added: ANY /api/{proxy+} -> <backend_url>/api/{proxy}.
resource "aws_apigatewayv2_integration" "backend" {
  api_id             = aws_apigatewayv2_api.this.id
  integration_type   = "HTTP_PROXY"
  integration_method = "ANY"
  integration_uri    = "${trimsuffix(var.backend_url, "/")}/api/{proxy}"
}

# The login route has no {proxy} path parameter, so it needs its own fixed-URL integration.
resource "aws_apigatewayv2_integration" "login" {
  api_id             = aws_apigatewayv2_api.this.id
  integration_type   = "HTTP_PROXY"
  integration_method = "POST"
  integration_uri    = "${trimsuffix(var.backend_url, "/")}/api/auth/login"
}

resource "aws_apigatewayv2_route" "proxy" {
  api_id    = aws_apigatewayv2_api.this.id
  route_key = "ANY /api/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.backend.id}"
}

# More specific route so it can carry its own (tighter) throttle in the stage.
resource "aws_apigatewayv2_route" "login" {
  api_id    = aws_apigatewayv2_api.this.id
  route_key = "POST /api/auth/login"
  target    = "integrations/${aws_apigatewayv2_integration.login.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  # Generous default: staff share one office IP, so this is only a flood guard.
  default_route_settings {
    throttling_rate_limit  = var.default_rate_limit
    throttling_burst_limit = var.default_burst_limit
  }

  route_settings {
    route_key              = aws_apigatewayv2_route.login.route_key
    throttling_rate_limit  = var.login_rate_limit
    throttling_burst_limit = var.login_burst_limit
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format = jsonencode({
      requestId        = "$context.requestId"
      ip               = "$context.identity.sourceIp"
      requestTime      = "$context.requestTime"
      httpMethod       = "$context.httpMethod"
      routeKey         = "$context.routeKey"
      status           = "$context.status"
      responseLength   = "$context.responseLength"
      integrationError = "$context.integrationErrorMessage"
    })
  }
}
