# State & Persistence Analysis

## State Storage

### In-Memory State (Volatile - VIOLATES VIBE RULE #4)

1. **Cache Map** (`const cache = new Map()`)
   - **Purpose**: Response caching with TTL
   - **Location**: github-mcp-enhanced.js:212
   - **Max Size**: 1000 entries (configurable)
   - **TTL**: 5 minutes (configurable)
   - **Risk**: ⚠️ HIGH - All cached data lost on restart, no persistence
   - **Violation**: Violates "Minimal state, durable truth" principle

2. **PR Rate Limiter Map** (`const prRateLimiter = new Map()`)
   - **Purpose**: Track PR creation rate limits per repository
   - **Location**: github-mcp-enhanced.js:215
   - **Risk**: ⚠️ HIGH - Rate limit state lost on restart, can be circumvented
   - **Violation**: Non-durable rate limiting allows bypass via server restart

3. **PR Merge Rate Limiter Map** (`const prMergeRateLimiter = new Map()`)
   - **Purpose**: Track PR merge rate limits per repository
   - **Location**: github-mcp-enhanced.js:216
   - **Risk**: ⚠️ HIGH - Same as PR rate limiter, lost on restart
   - **Violation**: Non-durable rate limiting

### External Persistence

1. **GitHub API** (Read/Write)
   - **Type**: External REST API
   - **Operations**: Read repos, create branches, commit files, manage PRs
   - **Authentication**: Bearer token (GITHUB_PAT)
   - **Durability**: ✅ GOOD - GitHub is source of truth

### Audit Logging

1. **PR Audit Log** (File-based)
   - **Location**: `./pr_audit.log` (configurable via PR_AUDIT_LOG)
   - **Purpose**: Audit trail for PR operations
   - **Format**: Append-only log file
   - **Durability**: ✅ GOOD - Persistent file storage
   - **Risk**: ⚠️ MEDIUM - No log rotation, can grow unbounded

## Violations Summary

| State Type | Storage | Durable? | Violation | Severity |
|------------|---------|----------|-----------|----------|
| Response Cache | In-memory Map | ❌ No | Lost on restart | HIGH |
| PR Rate Limiter | In-memory Map | ❌ No | Bypassable via restart | HIGH |
| Merge Rate Limiter | In-memory Map | ❌ No | Bypassable via restart | HIGH |
| GitHub State | External API | ✅ Yes | None | - |
| Audit Log | File System | ✅ Yes | No rotation | MEDIUM |

## Recommendations

1. **Replace in-memory Maps with Redis/Memcached** for cache and rate limiting
2. **Add startup recovery** for rate limiters from persistent storage
3. **Implement log rotation** for PR audit log (e.g., Winston with rotation)
4. **Consider database** for audit trails instead of flat file
5. **Add health checks** that verify persistent store connectivity

## VIBE Rule Compliance

✅ **Rule 4 Violation**: "Minimal state, durable truth - persistence in DB/object store; no cross-request in-memory state"

**Current**: ❌ FAIL - Critical state in volatile memory  
**Target**: Use Redis/Memcached for cache and rate limiting
