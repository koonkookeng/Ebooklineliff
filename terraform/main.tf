# SSOT Phase 125 §5.1 — multi-region replica registry (IaC declaration)
# Canonical: terraform/main.tf
# - RISK_CALL (documented): variables + outputs ONLY. No provider resources
#   are applied from this repo (deployments stay docker-compose + wrangler
#   anchored, zero new cloud coupling). Connection strings are never stored
#   here — they arrive via env (DATABASE_URL / DATABASE_REPLICA_*).
# - The 4 RegionZones mirror RegionZoneEnum (edge-infrastructure.schema).

variable "primary_region" {
  description = "Primary write region (PostgreSQL primary)"
  type        = string
  default     = "ASIA_SOUTHEAST_BANGKOK"
}

variable "replica_regions" {
  description = "Read-replica regions (subset of RegionZoneEnum)"
  type        = list(string)
  default     = ["ASIA_SOUTHEAST_SINGAPORE", "ASIA_EAST_TOKYO", "US_WEST_OREGON"]
}

output "primary_region" {
  value = var.primary_region
}

output "replica_regions" {
  value = var.replica_regions
}

output "edge_failover_budget_ms" {
  description = "BDD-2 reroute ceiling mirrored from the SSOT contract"
  value       = 200
}
