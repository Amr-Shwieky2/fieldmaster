output "alb_dns_name" {
  value = module.ecs.alb_dns_name
}

output "database_endpoint" {
  value = module.database.endpoint
}
