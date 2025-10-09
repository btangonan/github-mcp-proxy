# ChromaDB Memories - GitHub MCP ChatGPT Tool Failures Fix

Collection: `github_mcp_proxy_memory`

## Memories to Add

### Memory 1: validateBranch Bug
```json
{
  "id": "validateBranch_requires_param",
  "document": "validateBranch() in github-mcp-enhanced.js threw 'Branch name is required' when args.branch was undefined. Must provide default before calling validateBranch.",
  "metadata": {
    "type": "fix",
    "tags": "validateBranch,branch-handling,github-mcp-enhanced",
    "source": "github-mcp-enhanced.js:245"
  }
}
```

### Memory 2: Default Branch Detection Pattern
```json
{
  "id": "default_branch_detection",
  "document": "Always fetch actual default branch from GitHub API, never hardcode 'main'. Pattern: if (!branch) { repoInfo = await githubRequest('/repos/owner/repo'); branch = repoInfo.default_branch || 'main'; }",
  "metadata": {
    "type": "decision",
    "tags": "default-branch,github-api,pattern",
    "source": "BUG_FIX_REPORT.md"
  }
}
```

### Memory 3: Two Server Versions Confusion
```json
{
  "id": "two_server_versions",
  "document": "Project has github-mcp-v2.js and github-mcp-enhanced.js. Render uses enhanced.js (via package.json main). Different implementations: v2 returns {data,meta}, enhanced returns data directly.",
  "metadata": {
    "type": "tip",
    "tags": "architecture,server-versions,deployment",
    "source": "package.json"
  }
}
```

### Memory 4: Response Data Access Pattern
```json
{
  "id": "githubRequest_response_structure",
  "document": "github-mcp-v2.js githubRequest() returns {data, meta} - must access response.data.property. github-mcp-enhanced.js returns data directly - access response.property.",
  "metadata": {
    "type": "tip",
    "tags": "githubRequest,response-structure,data-access",
    "source": "github-mcp-v2.js:174,github-mcp-enhanced.js:1348"
  }
}
```

### Memory 5: ChatGPT Tool Failure Root Cause
```json
{
  "id": "chatgpt_400_errors_cause",
  "document": "ChatGPT HTTP 400 errors on read_file/list_directory/get_tree were caused by: 1) validateBranch requiring param, 2) hardcoded 'main' when repo uses 'master'. Fixed by fetching actual default branch.",
  "metadata": {
    "type": "fix",
    "tags": "chatgpt,400-error,troubleshooting",
    "source": "BUG_FIX_REPORT.md"
  }
}
```

### Memory 6: Branch Parameter Handling Best Practice
```json
{
  "id": "branch_param_best_practice",
  "document": "For optional branch params: 1) Try args.branch || args.ref, 2) If null, fetch actual default from GitHub API, 3) Then validate. Never assume 'main' as default.",
  "metadata": {
    "type": "decision",
    "tags": "branch-handling,best-practice,validation",
    "source": "github-mcp-enhanced.js:369-374"
  }
}
```

### Memory 7: Render Auto-Deploy Behavior
```json
{
  "id": "render_manual_deploy_needed",
  "document": "Render auto-deploy on git push may be delayed or require manual trigger from dashboard. Check uptime in /health to verify new deployment (uptime resets on deploy).",
  "metadata": {
    "type": "tip",
    "tags": "render,deployment,troubleshooting",
    "source": "deployment-experience"
  }
}
```

### Memory 8: Tool Testing Pattern
```json
{
  "id": "tool_testing_pattern",
  "document": "Test MCP tools with curl POST to /mcp endpoint: {jsonrpc:2.0, method:tools/call, params:{name:tool_name, arguments:{...}}, id:1}. Check for 'result' (success) vs 'error' in response.",
  "metadata": {
    "type": "tip",
    "tags": "testing,mcp-protocol,curl",
    "source": "test_live_server.sh"
  }
}
```

### Memory 9: Debugging Live Render Issues
```json
{
  "id": "render_log_debugging",
  "document": "Use mcp__render__list_logs with text filters to debug live issues. Check for: 1) Error messages, 2) Tool call args, 3) Which branch was used, 4) HTTP response codes.",
  "metadata": {
    "type": "tip",
    "tags": "debugging,render-logs,troubleshooting",
    "source": "troubleshooting-session"
  }
}
```

### Memory 10: GitHub Default Branch History
```json
{
  "id": "github_default_branch_change",
  "document": "Older repos use 'master', newer use 'main'. Never assume - always fetch actual default_branch from /repos/:owner/:repo endpoint. Many repos use custom defaults like 'develop'.",
  "metadata": {
    "type": "tip",
    "tags": "github,default-branch,compatibility",
    "source": "octocat/Hello-World"
  }
}
```

## How to Add to ChromaDB

When ChromaDB server is available, use:

```javascript
// Add all memories
await mcp__chroma__chroma_add_documents({
  collection_name: "github_mcp_proxy_memory",
  documents: [/* array of document strings */],
  metadatas: [/* array of metadata objects */],
  ids: [/* array of stable IDs */]
});
```

## Query Examples

To retrieve these memories later:

```javascript
// Find branch handling tips
await mcp__chroma__chroma_query_documents({
  collection_name: "github_mcp_proxy_memory",
  query_texts: ["how to handle branch parameters"],
  n_results: 5
});

// Find troubleshooting tips
await mcp__chroma__chroma_query_documents({
  collection_name: "github_mcp_proxy_memory",
  query_texts: ["ChatGPT tool failures debugging"],
  n_results: 5
});

// Find all fixes
await mcp__chroma__chroma_query_documents({
  collection_name: "github_mcp_proxy_memory",
  query_texts: ["bug fixes"],
  n_results: 10
});
```
