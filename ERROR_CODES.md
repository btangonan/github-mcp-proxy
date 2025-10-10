# JSON-RPC Error Codes

| Code | Meaning | Notes |
|------|---------|-------|
| -32001 | Permission denied | GitHub 403 or "permission denied" |
| -32002 | Not found | GitHub 404 or "not found" |
| -32003 | Validation error | GitHub 422 or "validation" |
| -32004 | Rate limit exceeded | "rate limit" in message |
| -32005 | PR not mergeable | merge_pull_request dirty/protections |
| -32006 | Head SHA mismatch | merge_pull_request stale sha guard |
| -32603 | Internal error | default fallback |

## Logging
Emit a single-line structured log for every JSON-RPC error:

````
jsonrpc_error tool={{tool}} code={{code}} repo={{owner}}/{{repo}} pr={{pr||"-"}} sha={{sha||"-"}} state={{mergeable_state||"-"}} msg="{{message}}"
````
