# GitHub MCP Server for ChatGPT - Project Memory

## Project Overview
**Purpose**: Enable ChatGPT to interact with GitHub repositories through MCP (Model Context Protocol) server
**Status**: ✅ WORKING - Server recovered from CPU overload, token updated
**Current URL**: `https://5855932f66dd.ngrok-free.app/sse`

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

## Enhanced Features (2025-09-24)

### 7. Enhanced PR Creation (NEW)
**Problem**: PR creation workflow required manual branch creation and file commits
**Solution**: Enhanced `create_pull_request` with automatic capabilities:
- **create_branch_if_missing**: Automatically creates head branch from base if it doesn't exist
- **files array**: Commits files to branch before creating PR
- **commit_message**: Custom commit message for files
- **Duplicate prevention**: Always checks for existing open PRs first

### 8. Idempotent Branch Creation (IMPROVED)
**Problem**: Branch creation failed when branch already existed
**Solution**: Made `create_branch` idempotent - returns success with existing branch info if it already exists

### 9. File Commit Tool (NEW)
**Problem**: No way to add files to branches programmatically
**Solution**: Added `commit_files` tool that:
- Creates blobs for multiple files
- Builds a tree with all files
- Creates a commit with proper author info
- Updates branch reference to new commit

## Tool Capabilities Summary
✅ **PR Discovery**: list_pull_requests, search_pull_requests, get_pull_request
✅ **Branch Operations**: create_branch (idempotent), get_branches
✅ **File Operations**: commit_files (add/update multiple files)
✅ **PR Creation**: Enhanced with auto-branch creation and file commits
✅ **Security**: Repository whitelist, rate limiting, audit logging

## Critical Bug Fixes (2025-09-24 Late Session)

### 10. validateBranch() Default Fallback (FIXED)
**Problem**: validateBranch() function was defaulting to 'main' when branch parameter was undefined
**Impact**: All branch creation attempts returned "Branch 'main' already exists" error
**Solution**: Removed default fallback, now properly throws error when branch is not provided
```javascript
// Before (BUG):
function validateBranch(branch) {
  if (!branch) return 'main';  // This caused all operations to target 'main'
  ...
}

// After (FIXED):
function validateBranch(branch) {
  assert(branch, 'Branch name is required');  // Now properly validates
  ...
}
```
**Result**: Branch creation and commit operations now work correctly with proper branch names

## Critical Bug Fix (2025-09-26)

### 11. Parameter Inconsistency Fix (FIXED)
**Problem**: `fetch` tool used `id` parameter while all other tools used `repo`, causing ChatGPT confusion
**Error**: "Repository ID must be a string" when ChatGPT sent `{"repo": "owner/name"}`
**Solution**: Standardized fetch tool to use `repo` parameter like all other tools
**Changes**:
- Line 331: `args.id` → `args.repo` in handleFetch
- Line 1416: Schema parameter `id` → `repo`
**Result**: All tools now consistently use `repo` for repository parameter

## ChatGPT Integration Success (2025-09-25)

### 12. Successful ChatGPT Connection (VERIFIED)
**Status**: ✅ FULLY OPERATIONAL
**Current Ngrok URL**: `https://5855932f66dd.ngrok-free.app/sse`
**Client**: openai-mcp v1.0.0 (Ashburn, Virginia - AWS US-East-1)

**Verified Operations**:
- ✅ SSE connection established
- ✅ MCP protocol initialized
- ✅ Tool listing successful
- ✅ Repository search working (`search` tool)
- ✅ Directory navigation functional (`list_directory` tool)
- ✅ File reading operational (`read_file` tool)

**ChatGPT Activity Log**:
1. Successfully searched: `repo:btangonan/nano-banana-runner runAnalyze.ts`
2. Successfully searched: `repo:btangonan/nano-banana-runner apps/nn/src/workflows`
3. Navigated directory tree: `/` → `apps` → `apps/nn` → `apps/nn/apps/gui/src/pages`
4. Successfully read: `apps/nn/apps/gui/src/pages/UploadAnalyze.tsx` (Gemini image analyzer)

**Tool Call Format Discovered**:
ChatGPT learned correct parameter format:
```json
{
  "repo": "btangonan/nano-banana-runner",
  "path": "apps/nn/apps/gui/src/pages/UploadAnalyze.tsx",
  "branch": "main"
}
```

**Notes**:
- Minor X-Forwarded-For warning from ngrok (non-critical)
- All core functionality working as expected
- ChatGPT can now access and analyze the Gemini image analyzer code

## Critical Bug Fix (2025-10-01)

### 13. ChatGPT Tool Failures - Branch Handling Bug (FIXED)
**Problem**: ChatGPT reported HTTP 400 errors when using `read_file`, `list_directory`, `get_tree` tools
**Root Causes**:
1. `validateBranch()` in github-mcp-enhanced.js required branch parameter, threw error when undefined
2. Tools defaulting to hardcoded `'main'` instead of fetching actual repo default branch
3. Repos like octocat/Hello-World use `'master'`, causing 404→400 errors

**Solution**:
- Fixed `validateBranch()` - added default branch fallback before validation
- Implemented actual default branch detection from GitHub API
- Pattern: `if (!branch) { repoInfo = await githubRequest('/repos/owner/repo'); branch = repoInfo.default_branch || 'main'; }`

**Commits**:
- `93bdc6f` - Fixed github-mcp-v2.js getDefaultBranch() data access
- `8be8f34` - Fixed validateBranch requiring branch parameter
- `52739d2` - Fixed read_file missing default branch fallback
- `9414ee9` - Use actual repo default branch (not hardcoded 'main')

**Files Modified**:
- `github-mcp-enhanced.js:369-374` - handleListDirectory() default branch detection
- `github-mcp-enhanced.js:433-437` - handleReadFile() default branch detection
- `github-mcp-enhanced.js:519-523` - handleGetTree() default branch detection

**Result**: ✅ All tools working without explicit branch parameters, auto-detects correct default branch

## Key Learnings

### Architecture
- Project has TWO server versions: github-mcp-v2.js and github-mcp-enhanced.js
- Render deploys: **github-mcp-enhanced.js** (via package.json main entry)
- Different implementations: v2 returns `{data, meta}`, enhanced returns `data` directly

### Default Branch Handling
- **Never assume 'main'** - older repos use 'master', some use 'develop' or custom defaults
- **Always fetch actual default**: `repoInfo.default_branch` from `/repos/:owner/:repo`
- **Pattern**: Check args.branch → args.ref → fetch default → validate

### Render Deployment
- Auto-deploy may be delayed or require manual trigger
- Verify deployment by checking `/health` endpoint uptime (resets on deploy)
- Use `mcp__render__list_logs` with text filters for live debugging

### Tool Testing
- Test with: `curl POST /mcp` with JSON-RPC payload
- Success: `{"result": {...}}`, Failure: `{"error": {...}}`
- Created `test_live_server.sh` for automated testing

## Next Steps (If Needed)
- Monitor PR audit log for usage patterns
- Consider implementing PR update/merge capabilities
- Implement PR comment functionality
- Test the enhanced PR creation with file commits
- Add ChromaDB memories when server available (see CHROMA_MEMORIES.md)

---
*Last Updated: 2025-10-01*
*Session Lead: Fixed ChatGPT tool failures - all tools now working with automatic default branch detection*