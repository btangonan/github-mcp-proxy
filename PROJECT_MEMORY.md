# GitHub MCP Server for ChatGPT - Project Memory

## Project Overview
**Purpose**: Enable ChatGPT to interact with GitHub repositories through MCP (Model Context Protocol) server
**Status**: ✅ WORKING - All branch parameter issues resolved
**Current URL**: `https://2eb8dcfb180a.ngrok-free.app/sse`

## Key Features Implemented
1. **PR Creation**: ChatGPT can create pull requests in whitelisted repositories
2. **PR Discovery**: List, search, and get detailed PR information to prevent duplicates
3. **Branch Creation**: Create new branches from any existing branch or commit
4. **Branch-aware Operations**: All tools correctly handle branch parameters
5. **Security Layers**: Repository whitelist, rate limiting, audit logging
6. **Real-time Data**: Caching disabled for accurate branch content

## Critical Fixes Applied

### 1. Branch Parameter Handling (FIXED)
**Problem**: `get_commits` and `read_file` were ignoring branch parameters, always returning main branch
**Solution**:
- Fixed `get_commits` to use `params.sha = branch` for GitHub API
- Fixed `read_file` error handling to check `validatedBranch` instead of raw `branch`
- Prevented silent fallback to main when specific branch requested

### 2. SSE Error Handling (FIXED)
**Problem**: 424/500 errors when ChatGPT tried to call tools
**Solution**: Return proper JSON-RPC error objects instead of HTTP error responses

### 3. Token Permissions (FIXED)
**Problem**: 403 errors on PR creation
**Solution**: User updated GitHub PAT to include `pull_requests:write` permission

### 4. Cache Invalidation (FIXED)
**Problem**: 5-minute cache returning stale branch data
**Solution**: Disabled caching entirely for real-time accuracy

### 5. PR Discovery Tools (FIXED)
**Problem**: ChatGPT couldn't find existing PRs, leading to duplicate creation attempts
**Solution**: Added three new tools:
- `list_pull_requests`: Deterministic PR listing with filters
- `search_pull_requests`: GitHub search API for PRs
- `get_pull_request`: Detailed PR information retrieval

### 6. Branch Creation Tool (NEW)
**Problem**: PR creation failed with 404 errors when branches didn't exist
**Solution**: Added `create_branch` tool:
- Creates new branches from any existing branch or commit
- Respects repository whitelist for security
- Audit logs all branch creation attempts
- Successfully created feat/decouple-analyze-remix and feat/one-click-analyze-remix

## Configuration (.env)
```
GITHUB_TOKEN=[PAT with pull_requests:write]
PORT=8788
PR_ENABLED=true
PR_WHITELIST=btangonan/*
PR_RATE_LIMIT_MAX=100
PR_RATE_LIMIT_WINDOW=600000
PR_AUDIT_LOG=./pr_audit.log
```

## Test Commands
```bash
# Test branch parameter handling
cd /tmp && bash test_read_file.sh
cd /tmp && bash test_fixed_mcp.sh

# Check ngrok URL
curl -s http://localhost:4040/api/tunnels | python3 -c "import json, sys; data = json.load(sys.stdin); print('Current URL:', data['tunnels'][0]['public_url'])"
```

## Architecture Notes
- **SSE Endpoint**: `/sse` for ChatGPT connection
- **MCP Endpoint**: `/mcp` for direct JSON-RPC calls
- **Branch Support**: Both `branch` and `ref` parameters accepted
- **Error Handling**: Comprehensive logging with emoji indicators

## Known Working Branches
- `btangonan/nano-banana-runner` repo:
  - `main`: Default branch
  - `feat/style-by-source-ui`: Contains `promptsPerImage` state (test marker)
  - Commit `f6bd244` exists on feature branch

## Session Achievements
- ✅ Implemented secure PR creation with multi-layer validation
- ✅ Fixed all branch parameter handling issues
- ✅ Resolved ChatGPT connection errors (424/500/403)
- ✅ Eliminated stale cache data problems
- ✅ Enhanced debugging with comprehensive logging
- ✅ Successfully tested with ChatGPT
- ✅ Added PR discovery tools to prevent duplicate creation attempts
- ✅ Fixed PR tools parameter validation issues
- ✅ Implemented branch creation tool with whitelist security
- ✅ Created missing branches (feat/decouple-analyze-remix, feat/one-click-analyze-remix)

## Next Steps (If Needed)
- Monitor PR audit log for usage patterns
- Consider implementing PR update/merge capabilities
- Implement PR comment functionality
- Test PR creation on newly created branches

---
*Last Updated: 2025-09-24*
*Session Lead: Added branch creation capability to resolve PR creation failures on non-existent branches*