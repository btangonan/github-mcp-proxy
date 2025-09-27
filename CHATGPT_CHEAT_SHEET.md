# GitHub MCP Server v2.0 — ChatGPT Cheat Sheet

**🚀 Permanent Server URL:** `https://github-mcp-server-v2.onrender.com/mcp`
**Status:** ✅ LIVE and healthy (no more ngrok timeouts!)

## Quick Reference
All tools use consistent parameters:
- `repo`: Always `"owner/repo"` format
- `ref`: Branch or commit (optional, defaults to main)
- `path`: Relative path. Root accepts `""` or `"/"`

---

## 🔍 Read-Only Tools (always available)

### 1) search — Find repositories
```json
{
  "query": "user:btangonan language:javascript",
  "sort": "stars",
  "per_page": 10
}
```

### 2) fetch — Get repo info + README
```json
{
  "repo": "btangonan/nano-banana-runner"
}
```

### 3) list_directory — Browse folders
```json
{
  "repo": "btangonan/nano-banana-runner",
  "path": "apps/nn",
  "ref": "main"
}
```
**Root directory:**
```json
{ "repo": "btangonan/nano-banana-runner", "path": "", "ref": "main" }
```
or
```json
{ "repo": "btangonan/nano-banana-runner", "path": "/", "ref": "main" }
```

### 4) read_file — Read file contents
```json
{
  "repo": "btangonan/nano-banana-runner",
  "path": "README.md",
  "ref": "main"
}
```

### 5) get_tree — Full repo structure
```json
{
  "repo": "btangonan/nano-banana-runner",
  "recursive": true
}
```

### 6) get_commits — Commit history
```json
{
  "repo": "btangonan/nano-banana-runner",
  "ref": "main",
  "per_page": 10
}
```

### 7) get_branches — List branches
```json
{
  "repo": "btangonan/nano-banana-runner"
}
```

---

## ✏️ Write Tools (btangonan/* repos only)

### 8) create_branch — Create new branch
```json
{
  "repo": "btangonan/nano-banana-runner",
  "branch": "feat/new-feature",
  "from_ref": "main",
  "fail_if_exists": false
}
```

After creating a branch, pass `"ref": "feat/new-feature"` to other calls.

---

## 💡 Common Patterns

### Explore a repository
1. `fetch`
2. `get_branches`
3. `list_directory` with `path: ""`
4. `read_file` for key files

### Create a feature branch
1. `create_branch` with `from_ref: "main"`
2. Use `ref: "your-branch"` in subsequent calls

### Navigate deeply
1. `list_directory` → `"apps"`
2. `list_directory` → `"apps/nn"`
3. `read_file` → `"apps/nn/package.json"`

---

## ⚠️ Important Notes

- Write ops allowed only on whitelisted repos: `btangonan/*`
- If `"ref"` is omitted, the default branch is used
- All responses include rate limits under `meta.rateLimit`
- Errors are structured with helpful hints
- Path normalization accepts `""`, `"/"`, and relative paths

---

## 🚨 Error Examples and Fixes

### ❌ "Repository must be in format owner/repo"
**Wrong:**
```json
{ "owner": "btangonan", "repo": "nano-banana-runner" }
```

**Right:**
```json
{ "repo": "btangonan/nano-banana-runner" }
```

### ❌ "Absolute paths not allowed"
**Wrong:**
```json
{ "path": "/absolute/path" }
```

**Right:**
```json
{ "path": "relative/path" }
```
or `""` or `"/"`

### ❌ "Branch creation failed"
- Confirm you have write access
- Verify the repo is in the `btangonan/*` whitelist
- Check whether the branch already exists

---

## 📊 Response Format
All responses include:
- Primary data in `content[0].text` (JSON string)
- Rate limit info in `meta.rateLimit`
- Structured errors with `code`, `message`, and `hint`

**Example successful response:**
```json
{
  "content": [{
    "type": "text",
    "text": "{\"repository\":\"btangonan/nano-banana-runner\",\"items\":[...]}"
  }]
}
```

**Example error response:**
```json
{
  "error": {
    "code": "InvalidInput",
    "message": "File path is required",
    "hint": "Example: {\"repo\": \"owner/repo\", \"path\": \"README.md\"}"
  }
}
```

---

*Last updated: 2025-09-26*
*Server version: v2.0*