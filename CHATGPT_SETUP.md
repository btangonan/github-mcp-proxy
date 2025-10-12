# ChatGPT Setup Guide

Complete guide for configuring ChatGPT to use the GitHub MCP Proxy with full read/write access.

## 🔧 Step 1: Configure Environment Variables in Render

Go to your Render dashboard: https://dashboard.render.com/web/srv-d3bbjul6ubrc739jvjqg

Click **"Environment"** tab and set these variables:

### Required Variables

```bash
# GitHub Personal Access Token (REQUIRED)
GITHUB_PAT=ghp_your_token_here

# Write operation secret (REQUIRED for write access)
MCP_WRITE_SECRET=a8f3e9d2c7b6a1f5e4d3c2b1a9f8e7d6c5b4a3f2e1d9c8b7a6f5e4d3c2b1a0f9

# Enable PR creation features
PR_ENABLED=true

# Whitelist repositories (use owner/* for all repos under owner)
PR_WHITELIST=btangonan/*
```

### Optional Variables (Recommended)

```bash
# Rate limiting
PR_RATE_LIMIT_MAX=10
PR_RATE_LIMIT_WINDOW=3600000

# Additional features
PR_TEMPLATE_REQUIRED=false
PR_UPDATE_ENABLED=true
PR_MERGE_ENABLED=true

# CORS origins
ALLOWED_ORIGINS=https://chatgpt.com,https://chat.openai.com,https://platform.openai.com
```

**After setting variables**: Click "Save Changes" and wait for Render to redeploy (~2 minutes)

---

## 🎯 Step 2: Understanding the URLs

Your server has two endpoint modes:

### Read-Only Access (Safer)
```
https://github-mcp-server-v2.onrender.com/mcp
```
**Available operations**: search, fetch, read_file, list_directory, get_tree, get_commits, get_branches, list_pull_requests, search_pull_requests, get_pull_request

### Full Access (Read + Write)
```
https://github-mcp-server-v2.onrender.com/mcp/a8f3e9d2c7b6a1f5e4d3c2b1a9f8e7d6c5b4a3f2e1d9c8b7a6f5e4d3c2b1a0f9
```
**Additional operations**: create_branch, commit_files, create_pull_request, update_pull_request, merge_pull_request

**Note**: The secret in the URL (`a8f3e9d2...`) must match your `MCP_WRITE_SECRET` environment variable.

---

## 📋 Step 3: ChatGPT Action Schema

### Option A: Read-Only Access (Recommended for Testing)

Copy this schema into ChatGPT Custom GPT Actions:

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "GitHub MCP Proxy - Read Only",
    "description": "GitHub MCP server with read-only operations",
    "version": "2.0.0"
  },
  "servers": [
    {
      "url": "https://github-mcp-server-v2.onrender.com/mcp"
    }
  ],
  "paths": {
    "/": {
      "post": {
        "operationId": "callMCPTool",
        "summary": "Call MCP tool (read-only)",
        "description": "Execute GitHub read operations: search, fetch, read files, list directories, get commits, branches, and PRs",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "jsonrpc": {
                    "type": "string",
                    "enum": ["2.0"],
                    "description": "JSON-RPC version"
                  },
                  "id": {
                    "type": ["string", "number"],
                    "description": "Request ID"
                  },
                  "method": {
                    "type": "string",
                    "enum": ["tools/list", "tools/call"],
                    "description": "MCP method"
                  },
                  "params": {
                    "type": "object",
                    "description": "Method parameters"
                  }
                },
                "required": ["jsonrpc", "method"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Successful response",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          }
        }
      }
    }
  }
}
```

### Option B: Full Access (Read + Write)

Copy this schema for full read/write access:

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "GitHub MCP Proxy - Full Access",
    "description": "GitHub MCP server with read and write operations",
    "version": "2.0.0"
  },
  "servers": [
    {
      "url": "https://github-mcp-server-v2.onrender.com/mcp/a8f3e9d2c7b6a1f5e4d3c2b1a9f8e7d6c5b4a3f2e1d9c8b7a6f5e4d3c2b1a0f9"
    }
  ],
  "paths": {
    "/": {
      "post": {
        "operationId": "callMCPTool",
        "summary": "Call MCP tool with full read/write access",
        "description": "Execute GitHub operations including read and write tools: create branches, commit files, create/update/merge PRs",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "jsonrpc": {
                    "type": "string",
                    "enum": ["2.0"],
                    "description": "JSON-RPC version"
                  },
                  "id": {
                    "type": ["string", "number"],
                    "description": "Request ID"
                  },
                  "method": {
                    "type": "string",
                    "enum": ["tools/list", "tools/call"],
                    "description": "MCP method"
                  },
                  "params": {
                    "type": "object",
                    "description": "Method parameters"
                  }
                },
                "required": ["jsonrpc", "method"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Successful response",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          }
        }
      }
    }
  }
}
```

---

## 🔨 Step 4: Available Tools

### Read Tools (Always Available)

| Tool | Description | Example |
|------|-------------|---------|
| `search` | Search GitHub repositories | "Search for React repositories" |
| `fetch` | Fetch repository metadata and README | "Fetch btangonan/test-repo" |
| `list_directory` | List contents of a directory | "List files in src/ directory" |
| `read_file` | Read file contents | "Read README.md from main branch" |
| `get_tree` | Get full repository tree structure | "Get tree structure of repo" |
| `get_commits` | Get recent commits | "Get last 10 commits" |
| `get_branches` | List all branches | "List all branches in repo" |
| `list_pull_requests` | List PRs in repository | "List open PRs" |
| `search_pull_requests` | Search PRs by criteria | "Search PRs by author" |
| `get_pull_request` | Get specific PR details | "Get PR #123" |
| `get_pr_mergeability` | Check if PR can be merged | "Check if PR #123 is mergeable" |
| `get_checks_for_sha` | Get CI/CD checks for commit | "Get checks for commit abc123" |

### Write Tools (Requires Full Access URL)

| Tool | Description | Example |
|------|-------------|---------|
| `create_branch` | Create new branch | "Create branch feature/auth from main" |
| `commit_files` | Commit files to branch | "Commit README.md to feature branch" |
| `create_pull_request` | Create new PR (can auto-create branch and commit files) | "Create PR with changes" |
| `update_pull_request` | Update existing PR | "Update PR #123 title" |
| `merge_pull_request` | Merge a PR | "Merge PR #123" |

---

## 📝 Example Usage in ChatGPT

### Read Operations
```
"Show me the README from btangonan/test-repo"
"List all open pull requests in btangonan/github-mcp-proxy"
"Search for repositories about machine learning"
"Get the last 5 commits from main branch"
```

### Write Operations (Full Access Only)
```
"Create a branch called feature/new-auth in btangonan/test-repo"
"Create a pull request with title 'Add authentication' from feature/new-auth to main"
"Commit this code to src/auth.js in the feature/new-auth branch"
"Merge pull request #42 in btangonan/test-repo"
```

---

## 🔒 Security Controls

Even with full write access, you're protected by multiple layers:

1. **URL Secret**: Only requests to `/mcp/<SECRET>` can perform write operations
2. **Repository Whitelist**: Only repos matching `PR_WHITELIST` (e.g., `btangonan/*`) can have PRs created
3. **Rate Limits**: Maximum operations per hour (configurable via `PR_RATE_LIMIT_MAX`)
4. **GitHub Token Permissions**: Only repos your `GITHUB_PAT` has access to
5. **Audit Logging**: All write operations logged to `pr_audit.log` in Render

---

## 🧪 Testing Your Setup

### Test 1: Health Check
```bash
curl https://github-mcp-server-v2.onrender.com/health
```
**Expected**: `{"status":"healthy","service":"GitHub MCP Enhanced v2.0","version":"2.0.0"}`

### Test 2: List Available Tools
```bash
curl -X POST https://github-mcp-server-v2.onrender.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Test 3: Test Write Access (if enabled)
```bash
curl -X POST https://github-mcp-server-v2.onrender.com/mcp/a8f3e9d2c7b6a1f5e4d3c2b1a9f8e7d6c5b4a3f2e1d9c8b7a6f5e4d3c2b1a0f9 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "create_branch",
      "arguments": {
        "repo": "btangonan/test-repo",
        "branch": "test-branch",
        "from": "main"
      }
    }
  }'
```

---

## 🐛 Troubleshooting

### Issue: "Write operations are disabled"
**Solution**: Set `MCP_WRITE_SECRET` environment variable in Render

### Issue: "Repository not whitelisted"
**Solution**: Add repository to `PR_WHITELIST` (e.g., `btangonan/*` or `btangonan/specific-repo`)

### Issue: "PR rate limit exceeded"
**Solution**: Wait for rate limit window to reset or increase `PR_RATE_LIMIT_MAX`

### Issue: ChatGPT can't access the endpoint
**Solution**:
1. Check Render deployment logs for errors
2. Verify server is running with `/health` endpoint
3. Ensure ChatGPT schema URL matches your actual endpoint

### Issue: "Authentication failed"
**Solution**: Verify `GITHUB_PAT` is set correctly in Render and has proper scopes

---

## ✅ Quick Setup Checklist

- [ ] Set `GITHUB_PAT` in Render environment
- [ ] Set `MCP_WRITE_SECRET` in Render environment (if using write operations)
- [ ] Set `PR_ENABLED=true` in Render (if using write operations)
- [ ] Set `PR_WHITELIST=btangonan/*` in Render (if using write operations)
- [ ] Save changes and wait for Render to redeploy (~2 minutes)
- [ ] Copy appropriate schema (read-only or full access) into ChatGPT Actions
- [ ] Test with ChatGPT: "List branches in btangonan/test-repo"
- [ ] Test write access (if enabled): "Create branch test-branch in btangonan/test-repo"

---

## 📚 Additional Resources

- **Server Health**: https://github-mcp-server-v2.onrender.com/health
- **Render Dashboard**: https://dashboard.render.com/web/srv-d3bbjul6ubrc739jvjqg
- **GitHub PAT Settings**: https://github.com/settings/tokens
- **Repository**: https://github.com/btangonan/github-mcp-proxy

---

## 🔐 Security Best Practices

1. **Keep Secrets Secret**: Never share your `MCP_WRITE_SECRET` or `GITHUB_PAT` publicly
2. **Use Whitelist**: Always configure `PR_WHITELIST` to limit which repos can be modified
3. **Monitor Logs**: Check Render logs and `pr_audit.log` regularly for suspicious activity
4. **Rotate Secrets**: Change `MCP_WRITE_SECRET` periodically or if compromised
5. **Limit GitHub Token**: Use fine-grained GitHub tokens with minimal necessary permissions
6. **Start Read-Only**: Test with read-only access first before enabling write operations

---

**Last Updated**: 2025-01-12
**Server Version**: 2.0.0
