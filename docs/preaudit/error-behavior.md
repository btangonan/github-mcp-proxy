# Error Handling & Retry Behavior Analysis

## Error Response Structure

### JSON-RPC Error Format
- **Standard**: JSON-RPC 2.0
- **Helper Function**: `jsonRpcError(res, id, code, message, data)`
- **HTTP Status**: Always 200 (JSON-RPC convention)
- **Structure**:
  ```json
  {
    "jsonrpc": "2.0",
    "id": "<request_id>",
    "error": {
      "code": <error_code>,
      "message": "<error_message>",
      "data": {}
    }
  }
  ```

### Error Classification
Found `classifyToolError` function that maps GitHub errors to JSON-RPC codes:
- **-32400**: Not found (404)
- **-32401**: Unauthorized/forbidden (401, 403)
- **-32429**: Rate limit (429)
- **-32409**: Conflict (409)
- **-32500**: Server error (5xx)
- **-32602**: Invalid params (validation errors)
- **-32603**: Internal error (catch-all)

### Standardization Score: **B (Good)**
✅ Consistent JSON-RPC 2.0 error format  
✅ Error classification helper function  
✅ HTTP 200 with JSON-RPC error (correct for JSON-RPC)  
❌ Not using Problem+JSON (RFC 7807) for REST endpoints  
❌ Error messages sometimes expose internal details

## Retry & Backoff

### Axios Retry Configuration
**Found**: ❌ NO - Axios client has NO retry configuration  
**Risk**: ⚠️ HIGH - Transient GitHub API failures cause immediate user errors

```javascript
// Current: No retry config
const apiClient = axios.create({
  baseURL: 'https://api.github.com',
  timeout: config.timeout,
  headers: { ... }
});
```

**Should Be**:
```javascript
import axiosRetry from 'axios-retry';

axiosRetry(apiClient, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    return axiosRetry.isNetworkOrIdempotentRequestError(error) 
      || error.response?.status === 429;
  }
});
```

### Idempotency Keys
**Found**: ❌ NO idempotency key support  
**Risk**: ⚠️ HIGH - Retry of write operations can create duplicates

## Error Handling Patterns

### Try-Catch Coverage
- **Total try-catch blocks**: 85 found
- **Coverage**: ✅ GOOD - Most async operations wrapped
- **Pattern**: Consistent catch → log → return JSON-RPC error

### Error Propagation
✅ Errors properly caught and converted to JSON-RPC format  
✅ Stack traces not exposed to clients  
❌ Some error messages expose internal state  
❌ No error aggregation/monitoring (e.g., Sentry)

## Rate Limiting Behavior

### GitHub API Rate Limiting
- **Detection**: ❌ NO - Does not check rate limit headers
- **Backoff**: ❌ NO - No exponential backoff on 429
- **User Feedback**: ❌ NO - Generic error on rate limit

### Application Rate Limiting
- **Implementation**: express-rate-limit middleware
- **Persistence**: ❌ IN-MEMORY - Lost on restart
- **Strategy**: Fixed window
- **Recommendation**: Use sliding window with Redis

## VIBE Rule Compliance

### Rule 5: "Fail fast, loud, recover gracefully"

| Aspect | Status | Grade |
|--------|--------|-------|
| Problem+JSON or equivalent | ⚠️ JSON-RPC (acceptable) | B |
| Retries/backoff | ❌ None | F |
| Idempotency keys | ❌ None | F |
| Error standardization | ✅ Consistent JSON-RPC | A |
| Stack trace protection | ✅ Not exposed | A |

**Overall**: ❌ PARTIAL COMPLIANCE - Missing retry/backoff and idempotency

## Recommendations

1. **Add axios-retry** with exponential backoff for transient failures
2. **Implement idempotency keys** for write operations (PRs, commits, branches)
3. **Add rate limit detection** from GitHub response headers
4. **Implement circuit breaker** for GitHub API (e.g., opossum)
5. **Add error monitoring** (Sentry, Datadog, New Relic)
6. **Sanitize error messages** to avoid internal state exposure
7. **Add retry budget** to prevent retry storms
