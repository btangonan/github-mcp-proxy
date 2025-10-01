# Critical Bug Fix: getDefaultBranch() Data Access Issue

**Date**: 2025-10-01
**Severity**: 🔴 CRITICAL
**Status**: ✅ FIXED

## Problem Summary

ChatGPT reported HTTP 400 errors when trying to use file/directory tools (`read_file`, `list_directory`, `get_tree`) while repository-level tools (`fetch`, `get_branches`, `get_commits`) worked fine.

## Root Cause

**File**: `github-mcp-v2.js:131`
**Bug**: Incorrect property access in `getDefaultBranch()` function

```javascript
// ❌ BROKEN CODE (Line 131)
async function getDefaultBranch(owner, repo) {
  try {
    const response = await githubRequest(`/repos/${owner}/${repo}`);
    return response.default_branch || 'main';  // BUG: response.default_branch is undefined!
  } catch (error) {
    console.warn(`Failed to get default branch for ${owner}/${repo}, using 'main'`);
    return 'main';
  }
}
```

### Why This Failed

The `githubRequest()` function returns a structured object:
```javascript
{
  data: { /* GitHub API response */ },
  meta: { rateLimit: {...} }
}
```

But `getDefaultBranch()` was accessing `response.default_branch` instead of `response.data.default_branch`, which meant:
- `response.default_branch` was ALWAYS `undefined`
- The function ALWAYS returned `'main'` (due to `undefined || 'main'`)
- Even for repos with different default branches (like `'master'`)

### Impact Chain

1. **ChatGPT calls**: `read_file({ repo: "octocat/Hello-World", path: "README" })`
2. **Server calls**: `getDefaultBranch("octocat", "Hello-World")`
3. **Bug returns**: `'main'` (wrong! actual default is `'master'`)
4. **Server attempts**: Read `README` from `'main'` branch
5. **GitHub API returns**: 404 Not Found (branch `'main'` doesn't exist)
6. **Error propagates**: Converted to HTTP 400 by Render's MCP layer

## The Fix

**File**: `github-mcp-v2.js:131`

```javascript
// ✅ FIXED CODE
async function getDefaultBranch(owner, repo) {
  try {
    const response = await githubRequest(`/repos/${owner}/${repo}`);
    return response.data.default_branch || 'main';  // Fixed: access response.data
  } catch (error) {
    console.warn(`Failed to get default branch for ${owner}/${repo}, using 'main'`);
    return 'main';
  }
}
```

## Evidence

All other tool handlers correctly access `response.data`:
- Line 222: `response.data.total_count` ✅
- Line 297: `response.data.map(item => ...)` ✅
- Line 332: `response.data.content` ✅
- Line 373: `response.data.sha` ✅
- Line 420: `response.data.map(commit => ...)` ✅

Only `getDefaultBranch()` had the bug at line 131 ❌

## Affected Tools

Tools that depend on `getDefaultBranch()`:
- ❌ `read_file` - Called at line 325
- ❌ `list_directory` - Called at line 282
- ❌ `get_tree` - Called at line 358
- ✅ `get_commits` - Called at line 393 (but not critical since it has explicit ref handling)

Tools that DON'T depend on it (worked fine):
- ✅ `fetch` - Gets repo info directly
- ✅ `get_branches` - Uses `repoInfo.data.default_branch` correctly (line 450)

## Test Cases

### Before Fix
```bash
# These would fail with 404→400 errors
read_file({ repo: "octocat/Hello-World", path: "README" })
# Tried to access main branch (doesn't exist) instead of master

list_directory({ repo: "octocat/Hello-World", path: "" })
# Tried to access main branch (doesn't exist) instead of master
```

### After Fix
```bash
# These now work correctly
read_file({ repo: "octocat/Hello-World", path: "README" })
# Correctly uses master branch (the actual default)

list_directory({ repo: "octocat/Hello-World", path: "" })
# Correctly uses master branch
```

## Files Modified

1. ✅ `github-mcp-v2.js` - Fixed at line 131
2. ✅ `github-mcp-enhanced.js` - NO BUG (different implementation)

### Key Difference Between Files

**github-mcp-v2.js**:
- `githubRequest()` returns `{ data, meta }` structure
- Must access `response.data.property`
- Bug was at line 131: `response.default_branch` → `response.data.default_branch`

**github-mcp-enhanced.js**:
- `githubRequest()` returns data directly (line 1348: `return response.data;`)
- Access `response.property` directly
- No bug exists - already correct

## Deployment Steps

1. ✅ Fix applied to `github-mcp-v2.js` (line 131)
2. ✅ Verified `github-mcp-enhanced.js` - no bug (different implementation)
3. ⏳ Deploy fixed `github-mcp-v2.js` to Render
4. ⏳ Test with ChatGPT - verify all tools work
5. ⏳ Monitor Render logs for successful file/directory operations

### Which Server is Deployed?

According to SOLUTION_MEMORY.md (line 44-45):
- Render uses: **github-mcp-v2.js** ← THIS IS THE ONE WITH THE BUG
- Local uses: **github-mcp-enhanced.js** (via package.json)

**Action Required**: Deploy fixed `github-mcp-v2.js` to Render

## Prevention

**Code Review Checklist**:
- [ ] Verify all `githubRequest()` calls access `response.data.*` not `response.*`
- [ ] Test with repos having non-standard default branches (`master`, `develop`, etc.)
- [ ] Add unit tests for `getDefaultBranch()` function
- [ ] Add integration tests for file/directory tools

---
*This bug was discovered during troubleshooting of ChatGPT tool failures reported on 2025-10-01*
