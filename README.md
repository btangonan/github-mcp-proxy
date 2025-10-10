# GitHub MCP Server for ChatGPT 🚀 **[WORKING SOLUTION]**

A fully functional MCP (Model Context Protocol) server that enables ChatGPT to browse GitHub repositories, read files, and access code directly through connectors. **This actually works** - tested and confirmed with ChatGPT!

## Features

- 🔍 **Search** GitHub repositories
- 📂 **Browse** directory contents
- 📄 **Read** individual files
- 🌳 **View** full repository structures
- 📜 **Access** commit history
- 🌿 **List** repository branches
- 🔧 **PR tools**: create, update (ready-for-review), and merge (optional, guarded, whitelisted)
- 🔒 **Secure**: Your PAT stays on your local machine

## Prerequisites

- Node.js 18+ installed
- GitHub Personal Access Token
- ngrok account (free) - ChatGPT requires public HTTPS URLs
- ChatGPT with ability to add custom connectors

## Quick Start (5 minutes) ✅

**Want the absolute simplest setup? See [QUICKSTART.md](QUICKSTART.md) for 3-step instructions!**

### 1. Clone and Install

```bash
git clone https://github.com/yourusername/github-mcp-proxy.git
cd github-mcp-proxy
npm install
```

### 2. Configure GitHub Token

Create `.env` file:
```bash
GITHUB_PAT=ghp_yourPersonalAccessTokenHere
PORT=8788
```

Get your GitHub PAT from [github.com/settings/tokens](https://github.com/settings/tokens) with `public_repo` scope.

### 3. Install ngrok

```bash
# macOS
brew install ngrok

# Sign up for free account at
# https://dashboard.ngrok.com/signup

# Configure your auth token
ngrok config add-authtoken YOUR_NGROK_TOKEN
```

### 4. Start the Server

```bash
# Terminal 1: Start MCP server
node github-mcp-enhanced.js

# Terminal 2: Create public tunnel
ngrok http 8788
```

You'll see:
```
Forwarding: https://abc123.ngrok-free.app -> http://localhost:8788
```

### 5. Add to ChatGPT

1. Go to ChatGPT → Settings → Connectors
2. Click "Add Connector"
3. Fill in:
   - **Name**: `github_connect`
   - **URL**: `https://YOUR_NGROK_URL.ngrok-free.app/sse`
   - **Auth**: No authentication
4. Check "I trust this application"
5. Click "Create"

### 6. Use in ChatGPT

Start a new chat with the connector enabled:

- "Browse the src folder in facebook/react"
- "Read the README from vercel/next.js"
- "Show me recent commits in microsoft/vscode"
- "Get the full tree structure of vuejs/vue"

## Available MCP Tools

| Tool | Description | Example Request |
|------|-------------|-----------------|
| `search` | Search GitHub repositories | "Find React UI libraries" |
| `fetch` | Get repository metadata | "Info about facebook/react" |
| `list_directory` | Browse folder contents | "Show files in src/components" |
| `read_file` | Read file contents | "Read package.json from vercel/next.js" |
| `get_tree` | Full repository structure | "Show entire repo structure" |
| `get_commits` | Recent commit history | "Show last 10 commits" |
| `get_branches` | List all branches | "What branches exist?" |
| `create_pull_request` | Create PRs (requires setup) | "Create PR from feature-branch" |
| `update_pull_request` | Edit PR title/body, change draft, add reviewers | "Mark PR #123 ready for review" |
| `merge_pull_request` | Merge PR with merge/squash/rebase, optional delete branch | "Squash-merge PR #123 and delete branch" |
| `get_pr_mergeability` | PR mergeable state and checks summary | "Is PR #123 mergeable?" |
| `get_checks_for_sha` | Combined status and check runs for a commit | "Checks for sha abcdef1" |

## How It Works

1. **Local MCP Server**: Implements the Model Context Protocol with GitHub API integration
2. **ngrok Tunnel**: Provides the public HTTPS URL that ChatGPT requires
3. **GitHub API**: Server uses your PAT to fetch repository data
4. **MCP Tools**: Tools for browsing and PR workflows (create/update/merge)

## 🎯 PR Features (Create, Update, Merge) — Optional

The server includes **optional PR tools** (create, update, merge) that are **disabled by default** for security. Merges respect branch protections and required checks; protections are never bypassed.

### Security Design

The PR feature implements multiple security layers:
- **🔐 Path-Based Write Secret (NEW)** - Write operations require secret in URL path (`/mcp/<SECRET>`)
  - Read operations: `/mcp` (public)
  - Write operations: `/mcp/<SECRET>` (requires secret)
  - Prevents casual drive-by writes while keeping reads accessible
  - Secret can be rotated if exposed
- **Disabled by default** - Requires explicit opt-in
- **Repository whitelist** - Only specified repos can have PRs created/updated/merged
- **Branch validation** - Actions occur on explicitly named branches
- **No direct pushes** - Changes only via PRs or the explicit `commit_files` tool when allowed
- **Rate limiting** - Separate limits for PR operations and merges
- **Audit logging** - All PR attempts and merges are logged
- **Token scopes** - PAT must have `repo` (classic) or fine-grained "Pull requests: Read and write"; orgs may require `read:org` to read checks

### Enabling PR Creation

1. **Update your `.env` file**:
```bash
# Enable write secret for path-based security (REQUIRED for write operations)
MCP_WRITE_SECRET=63d8fd675336252cf31ef502684ce7a28bf2585f3f2f9e3a67027802d131d8fa

# Enable PR creation
PR_ENABLED=true

# Whitelist repositories (required)
# Format: owner/repo or owner/* for all repos under owner
PR_WHITELIST=yourusername/test-repo,yourusername/another-repo

# Optional: Configure rate limits (defaults shown)
PR_RATE_LIMIT_MAX=5           # Max 5 PRs per hour
PR_RATE_LIMIT_WINDOW=3600000  # 1 hour in milliseconds

# Optional: Audit log location
PR_AUDIT_LOG=./pr_audit.log

# Optional: Require [ChatGPT] tag in PR descriptions
PR_TEMPLATE_REQUIRED=false
```

2. **Ensure your GitHub PAT has the `repo` scope**:
   - Go to [github.com/settings/tokens](https://github.com/settings/tokens)
   - Your PAT needs `repo` scope (not just `public_repo`) for PR creation
   - Regenerate token with proper scope if needed

3. **Restart the server** to apply changes

### Using PR Creation in ChatGPT

**IMPORTANT**: For write operations, configure ChatGPT connector with the secret URL:
- **Read-only URL**: `https://YOUR_NGROK_URL.ngrok-free.app/mcp`
- **Write-enabled URL**: `https://YOUR_NGROK_URL.ngrok-free.app/mcp/<YOUR_SECRET>`

Once enabled, you can ask ChatGPT to:
- "Create a PR from my feature-branch to main in myrepo"
- "Open a pull request for the bug fix branch"
- "Create a PR with title 'Add new feature' from develop branch"

ChatGPT will:
1. Verify the repository is whitelisted
2. Check that the source branch exists
3. Create the PR with your specified details
4. Return the PR URL for review

### PR Feature Configuration

| Setting | Environment Variable | Default | Description |
|---------|---------------------|---------|-------------|
| Enable PR Creation | `PR_ENABLED` | `false` | Master switch for PR feature |
| Repository Whitelist | `PR_WHITELIST` | Empty | Comma-separated list of allowed repos |
| Max PRs per Window | `PR_RATE_LIMIT_MAX` | `5` | Maximum PRs in time window |
| Rate Limit Window | `PR_RATE_LIMIT_WINDOW` | `3600000` | Time window in milliseconds (1 hour) |
| Audit Log Path | `PR_AUDIT_LOG` | `./pr_audit.log` | Where to log PR attempts |
| Template Required | `PR_TEMPLATE_REQUIRED` | `false` | Require [ChatGPT] tag in PR body |

### Whitelist Patterns

The whitelist supports two patterns:
- **Exact match**: `owner/repository` - Only this specific repo
- **Wildcard**: `owner/*` - All repos under this owner

Examples:
```bash
# Single repository
PR_WHITELIST=mycompany/main-app

# Multiple specific repos
PR_WHITELIST=mycompany/app1,mycompany/app2,personal/project

# All repos under an owner
PR_WHITELIST=mycompany/*

# Mix of patterns
PR_WHITELIST=mycompany/*,trusted-org/specific-repo
```

### Important Security Notes

⚠️ **PR Creation Risks**:
- Even with guards, PRs can trigger CI/CD pipelines
- PRs may be auto-merged if you have branch protection rules configured
- Team members get notifications for new PRs
- PR descriptions become permanent git history

✅ **Best Practices**:
- Start with test repositories only
- Use specific repo whitelisting (avoid wildcards initially)
- Monitor the audit log regularly
- Set conservative rate limits
- Review PRs before merging

🔒 **What PR Tools CANNOT Do**:
- Cannot bypass branch protections or required reviews/checks
- Cannot merge if required checks are failing or pending
- Cannot access or modify repositories not in the whitelist
- Cannot delete protected or default branches
- No direct pushes; changes must be via PRs or the explicit `commit_files` tool
- All actions are logged to `PR_AUDIT_LOG`

## Scripts

- `npm start` - Start the enhanced MCP server
- `npm run dev` - Start with auto-reload (if nodemon installed)

The server runs on port 8788 by default (configurable in `.env`).

## Troubleshooting

**"Error creating connector"**
- Make sure you're using the ngrok HTTPS URL, not localhost
- ChatGPT blocks all localhost/HTTP URLs for security
- Ensure the `/sse` endpoint is included in the URL

**No requests in logs**
- ChatGPT blocks localhost - you must use ngrok
- Verify ngrok is running and forwarding to port 8788
- Check ngrok dashboard at http://localhost:4040

**Connector is grayed out**
- Connectors are enabled per-conversation
- Start a NEW chat and enable the connector

**Authentication errors**
- Verify your PAT has `public_repo` scope
- Check that the token hasn't expired
- Ensure the PAT is in the `.env` file

## Security Notes

- ✅ **Path-based write secret** protects write operations via URL path
- ✅ Your PAT stays on your local machine
- ✅ ngrok provides secure HTTPS tunneling
- ✅ ChatGPT never sees your actual token
- ✅ PR creation is disabled by default (opt-in feature)
- ✅ Repository whitelist enforced for PR creation
- ✅ Read operations accessible via `/mcp`, writes via `/mcp/<SECRET>`
- ⚠️ Never commit `.env` to version control
- ⚠️ Review PR feature risks before enabling
- ⚠️ Rotate `MCP_WRITE_SECRET` if exposed or leaked

## Project Structure

```
github-mcp-proxy/
├── github-mcp-enhanced.js  # Main MCP server (v2.0)
├── .env                     # Your GitHub PAT (git-ignored)
├── package.json            # Dependencies
└── README.md              # This file
```

## License

MIT

## PR Merge Setup and Testing

Merging is optional and disabled by default. When enabled, merges are safe, respect branch protections and required checks, and are fully audited.

### Enable PR Merge

1) Update your .env:
```bash
PR_MERGE_ENABLED=true
PR_MERGE_RATE_LIMIT_MAX=5
PR_MERGE_RATE_LIMIT_WINDOW=3600000
```

2) Ensure your PAT scope:
- Classic: repo
- Fine-grained: Pull requests: Read and write (and repository contents if needed)
- Some orgs may require read:org to read checks metadata

3) Whitelist repositories:
- Uses PR_WHITELIST (same as PR creation)
- Format: owner/repo or owner/*

4) Restart the server.

### New Tools

- merge_pull_request
- update_pull_request
- get_pr_mergeability
- get_checks_for_sha

### Example JSON-RPC tests (curl)

List PRs:
```bash
curl -s http://localhost:8788/mcp -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":"1","method":"tools/call",
  "params":{"name":"list_pull_requests","arguments":{"repo":"owner/repo","state":"open","limit":5}}
}'
```

Check mergeability and required checks:
```bash
curl -s http://localhost:8788/mcp -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":"2","method":"tools/call",
  "params":{"name":"get_pr_mergeability","arguments":{"repo":"owner/repo","prNumber":123}}
}'
```

Get checks for a specific commit SHA:
```bash
curl -s http://localhost:8788/mcp -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":"2b","method":"tools/call",
  "params":{"name":"get_checks_for_sha","arguments":{"repo":"owner/repo","sha":"abcdef123456"}}
}'
```

Mark draft PR ready for review:
```bash
curl -s http://localhost:8788/mcp -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":"2c","method":"tools/call",
  "params":{"name":"update_pull_request","arguments":{"repo":"owner/repo","prNumber":123,"draft":false}}
}'
```

Happy-path merge (squash and delete branch):
```bash
curl -s http://localhost:8788/mcp -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":"3","method":"tools/call",
  "params":{"name":"merge_pull_request","arguments":{
    "repo":"owner/repo","prNumber":123,"merge_method":"squash","delete_branch":true
  }}}
}'
```

Safety merge with SHA guard:
```bash
curl -s http://localhost:8788/mcp -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":"4","method":"tools/call",
  "params":{"name":"merge_pull_request","arguments":{
    "repo":"owner/repo","prNumber":123,"sha":"<HEAD_SHA_FROM_get_pr_mergeability>"
  }}}
}'
```

Blocked merge example:
- Returns clean reason including mergeable_state and failing checks/status contexts.

### Guardrails

- Whitelist enforced via PR_WHITELIST
- Separate rate limits for merges vs. PR creation
- Optional SHA guard to avoid merging stale heads
- Never bypasses branch protections or required checks
- Attempts, blocks, failures, and successes audited to PR_AUDIT_LOG
