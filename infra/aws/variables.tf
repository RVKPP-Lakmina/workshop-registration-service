variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment (matches APP_ENV); used in resource names and tags"
  type        = string

  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "environment must be one of: development, staging, production."
  }
}

variable "name" {
  description = "Name prefix for the API"
  type        = string
  default     = "workshop-registration"
}

variable "backend_url" {
  description = "Origin that serves /api (e.g. https://alb.example.com)."
  type        = string
}

variable "cors_allowed_origins" {
  description = "Browser origins allowed by CORS"
  type        = list(string)
  default     = ["https://workshops.example.com"]
}

variable "default_rate_limit" {
  description = "Steady-state requests/second for all routes (generous: offices share one IP)"
  type        = number
  default     = 100
}

variable "default_burst_limit" {
  description = "Burst capacity for all routes"
  type        = number
  default     = 200
}

variable "login_rate_limit" {
  description = "Steady-state requests/second for POST /api/auth/login"
  type        = number
  default     = 2
}

variable "login_burst_limit" {
  description = "Burst capacity for POST /api/auth/login"
  type        = number
  default     = 5
}

variable "log_retention_days" {
  description = "CloudWatch access log retention"
  type        = number
  default     = 30
}
