output "alb_dns_name" {
  value = module.ecs.alb_dns_name
}

output "cloudfront_domain_name" {
  value = module.storage.cloudfront_domain_name
}

output "database_endpoint" {
  value = module.database.endpoint
}

output "ecs_cluster_name" {
  value = module.ecs.cluster_name
}
