# GitHub MCP Server - Technical Guide

## Architecture

The GitHub MCP Server implements the Model Context Protocol to enable ChatGPT to interact with GitHub repositories through a secure local server and ngrok tunnel.

```
ChatGPT → ngrok (HTTPS) → Local MCP Server → GitHub API
```

## Why ngrok is Required

ChatGPT enforces strict security policies:
- ❌ Blocks all `http://localhost` connections
- ❌ Blocks all HTTP (non-HTTPS) URLs
- ✅ Only accepts public HTTPS URLs
- ✅ ngrok provides secure tunneling with HTTPS endpoints

## MCP Protocol Implementation

### Required Endpoints

1. **`/mcp`** - JSON-RPC endpoint for MCP commands
2. **`/sse`** - Server-Sent Events for streaming (required by ChatGPT)

### Protocol Methods

- `initialize` - Handshake with protocol version matching
- `tools/list` - Returns available GitHub tools
- `tools/call` - Executes specific tool with parameters

### Critical: Protocol Version

ChatGPT sends a specific protocol version (e.g., "2025-06-18") that MUST be echoed back:

```javascript
protocolVersion: params?.protocolVersion || "2025-06-18"
```

## Available Tools

### search
Search GitHub repositories by query.
```javascript
{ query: "react hooks" }
→ Returns array of matching repositories
```

### fetch
Get repository metadata and README.
```javascript
{ id: "facebook/react" }
→ Returns full repository details
```

### list_directory
Browse folder contents in a repository.
```javascript
{ repo: "facebook/react", path: "src/components" }
→ Returns list of files and subdirectories
```

### read_file
Read specific file contents.
```javascript
{ repo: "facebook/react", path: "README.md" }
→ Returns file content as text
```

### get_tree
Get complete repository structure.
```javascript
{ repo: "facebook/react" }
→ Returns hierarchical tree of all files
```

### get_commits
Retrieve commit history.
```javascript
{ repo: "facebook/react", limit: 10 }
→ Returns recent commits with metadata
```

### get_branches
List repository branches.
```javascript
{ repo: "facebook/react" }
→ Returns all branch names
```

## Response Format

All tool responses must follow MCP format:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "JSON-stringified-result"
      }
    ]
  }
}
```

## Error Handling

The server handles common GitHub API issues:
- Branch detection (tries 'main' then 'master')
- Missing README files
- Rate limiting
- Invalid repository formats

## Testing

### Local Testing
```bash
# Test tool listing
curl -X POST http://localhost:8788/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Test directory browsing
curl -X POST http://localhost:8788/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"list_directory",
      "arguments":{"repo":"facebook/react","path":"src"}
    },
    "id":1
  }'
```

### Health Check
```bash
curl http://localhost:8788/health
```

## Deployment Options

### Development (ngrok)
- Quick setup for testing
- URL changes on restart
- Free tier sufficient

### Production Options
1. **Paid ngrok** - Stable subdomain
2. **Cloudflare Tunnel** - Free alternative to ngrok
3. **VPS Deployment** - Full control with HTTPS
4. **Vercel/Netlify** - Serverless deployment

## Common Issues

### Issue: ChatGPT Can't Connect
**Cause**: Using localhost instead of ngrok URL
**Solution**: Always use the public HTTPS URL from ngrok

### Issue: Protocol Version Mismatch
**Cause**: Returning fixed version instead of echoing ChatGPT's version
**Solution**: Use `params?.protocolVersion` in response

### Issue: SSE Endpoint Missing
**Cause**: Only implementing /mcp endpoint
**Solution**: Implement both /mcp and /sse endpoints

### Issue: Tool Not Found
**Cause**: Tool name mismatch or not registered
**Solution**: Ensure tool is listed in tools/list response

## Environment Variables

```bash
GITHUB_PAT=ghp_xxxx  # GitHub Personal Access Token
PORT=8788            # Server port (default: 8788)
```

## Security Considerations

- PAT never leaves your local machine
- ngrok provides encrypted tunnel
- ChatGPT never sees your actual token
- All GitHub requests use your PAT securely
- Consider read-only scopes for safety

## File Structure

```
github-mcp-enhanced.js  # Main server implementation
├── MCP Protocol Handler
│   ├── initialize()
│   ├── tools/list()
│   └── tools/call()
├── GitHub API Integration
│   ├── search tool
│   ├── fetch tool
│   ├── list_directory tool
│   ├── read_file tool
│   ├── get_tree tool
│   ├── get_commits tool
│   └── get_branches tool
└── SSE Endpoint
    ├── Connection handling
    └── Heartbeat keepalive
```