-- SSOT Phase 087 §5.2 — Atomic flash stock reservation (Redis Lua)
-- Canonical: apps/backend/src/modules/flash-sale/lua/reserve_stock.lua
-- CLUSTER RULE: KEYS[1] and KEYS[2] MUST share one {flash:...} hash tag —
-- cross-slot scripts fail on Redis Cluster. Callers build both keys from
-- flashTag() in flash-sale-contract.ts.
-- KEYS[1]: available-stock counter (seeded: allocated − reserved − sold)
-- KEYS[2]: per-user take counter (maxPerUser guard)
-- ARGV[1]: quantity requested
-- ARGV[2]: max-per-user limit
-- Returns: {1, "SUCCESS", remaining} | {0, CODE, stock}
local current_stock = tonumber(redis.call('GET', KEYS[1]) or '-1')
if current_stock == -1 then
  return {0, "ITEM_NOT_FOUND_IN_CACHE", 0}
end

if current_stock < tonumber(ARGV[1]) then
  return {0, "OUT_OF_STOCK", current_stock}
end

local user_bought = tonumber(redis.call('GET', KEYS[2]) or '0')
if (user_bought + tonumber(ARGV[1])) > tonumber(ARGV[2]) then
  return {0, "EXCEEDS_MAX_PER_USER", current_stock}
end

redis.call('DECRBY', KEYS[1], ARGV[1])
redis.call('INCRBY', KEYS[2], ARGV[1])

return {1, "SUCCESS", current_stock - tonumber(ARGV[1])}
