# JSON-RPC Error Codes

| Code | Meaning | Notes |
|------|---------|-------|
| -32602 | Invalid params | **JSON Schema validation failure** - see Schema Validation section below |
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

---

## Schema Validation (-32602)

All MCP tool parameters are validated using JSON Schema before execution. Validation failures return error code **-32602** (Invalid params) with detailed error information.

### Error Response Format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Validation errors: must have required property 'query'",
    "data": {
      "tool": "search",
      "validation_errors": [
        {
          "message": "must have required property 'query'",
          "path": "root",
          "keyword": "required",
          "params": {"missingProperty": "query"},
          "value": {}
        }
      ],
      "timestamp": "2025-10-12T15:49:21.049Z"
    }
  }
}
```

### Validation Rules

#### Common Patterns

All tools follow these patterns:

- **Repository Format**: `owner/repo` (regex: `^[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+$`)
- **Branch Name**: (regex: `^[a-zA-Z0-9._/-]+$`, max 100 chars)
- **Commit SHA**: (regex: `^[a-f0-9]{7,40}$`, 7-40 hex chars)
- **Pagination**: `page` (1-100), `per_page` (1-100)

#### String Length Limits

| Field | Min | Max | Notes |
|-------|-----|-----|-------|
| `query` (search) | 1 | 256 | Search queries |
| `path` (files/dirs) | 1 | 500 | File/directory paths |
| `title` (PR) | 1 | 256 | Pull request titles |
| `body` (PR) | 0 | 10000 | Pull request descriptions |
| `message` (commit) | 1 | 256 | Commit messages |
| `commit_title` | 0 | 256 | Merge commit titles |
| `commit_message` | 0 | 10000 | Merge commit messages |

#### Tool-Specific Rules

**search**
- Required: `query` (string, 1-256 chars)
- Optional: `page` (1-100), `per_page` (1-100)
- No additional properties allowed

**fetch**
- Required: `repo` (owner/repo format)
- No additional properties allowed

**list_directory**
- Required: `repo`, `path`
- Optional: `branch` OR `ref` (not both)
- `path` max 500 chars

**read_file**
- Required: `repo`, `path` (min 1 char)
- Optional: `branch` OR `ref`

**get_tree**
- Required: `repo`
- Optional: `branch` OR `ref`

**get_commits**
- Required: `repo`
- Optional: `branch`, `sha` (7-40 hex), `page`, `per_page`

**get_branches**
- Required: `repo`
- Optional: `page`, `per_page`

**list_pull_requests**
- Required: `repo`
- Optional: `state` (enum: `open`, `closed`, `all`), `page`, `per_page`

**get_pr_mergeability**
- Required: `repo`, `prNumber` (integer, min 1)

**get_checks_for_sha**
- Required: `repo`, `sha` (7-40 hex chars)

**create_pull_request**
- Required: `repo`, `title`, `head`, `base`
- Optional: `body` (max 10k), `draft` (boolean)
- `title` max 256 chars

**update_pull_request**
- Required: `repo`, `prNumber`
- Optional: `title`, `body`, `state` (enum: `open`, `closed`), `draft`

**merge_pull_request**
- Required: `repo`, `prNumber`
- Optional: `merge_method` (enum: `merge`, `squash`, `rebase`), `commit_title`, `commit_message`, `sha`, `delete_branch`

**commit_files**
- Required: `repo`, `branch`, `message`, `files` (array, 1-20 items)
- Each file requires: `path` (1-500 chars), `content` (string)
- Optional per file: `encoding` (enum: `utf8`, `base64`)

### Common Validation Errors

**Missing Required Property**
```
Validation errors: must have required property 'query'
```
**Solution**: Include all required parameters for the tool.

**Invalid Pattern**
```
Validation errors: must match pattern "^[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+$"
```
**Solution**: Format repository as `owner/repo` with valid characters.

**String Too Long**
```
Validation errors: must NOT be longer than 256 characters
```
**Solution**: Reduce string length to match limit.

**Additional Properties**
```
Validation errors: must NOT have additional properties
```
**Solution**: Remove unexpected parameters from request.

**Invalid Enum Value**
```
Validation errors: must be equal to one of the allowed values
```
**Solution**: Use only the allowed enum values (e.g., `open`, `closed`, `all` for PR state).

**Invalid Type**
```
Validation errors: must be integer
```
**Solution**: Ensure parameter is the correct type (number, string, boolean, array, object).

**Out of Range**
```
Validation errors: must be >= 1
```
**Solution**: Use values within the valid range (e.g., page numbers 1-100).

### Testing Validation

Example test with invalid params (missing `query`):

```bash
curl -X POST http://localhost:8788/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "search",
      "arguments": {}
    }
  }'
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Validation errors: must have required property 'query'",
    "data": {
      "tool": "search",
      "validation_errors": [...],
      "timestamp": "2025-10-12T15:49:21.049Z"
    }
  }
}
```

### Implementation Details

- **Library**: AJV (Another JSON Validator) v8.17.1
- **Validation Layer**: Defense-in-depth (schema validation → tool validation)
- **Location**: `mcp-tool-schemas.js` module
- **Integration**: github-mcp-enhanced.js:2439-2448
- **Tests**: 81 unit tests in `tests/unit/schema-validation.test.js`

For complete schema definitions, see: `mcp-tool-schemas.js`
