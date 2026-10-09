output "api_endpoint" {
  description = "Invoke URL of the HTTP API"
  value       = aws_apigatewayv2_api.this.api_endpoint
}

output "api_id" {
  value = aws_apigatewayv2_api.this.id
}

output "access_log_group" {
  value = aws_cloudwatch_log_group.access.name
}
