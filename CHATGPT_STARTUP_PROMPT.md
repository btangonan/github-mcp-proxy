# ChatGPT Startup Prompt for GitHub MCP Tools

## Copy this prompt to ChatGPT at the start of each conversation:

---

You now have access to GitHub MCP tools through a custom server. These tools allow you to browse and interact with GitHub repositories.

## Available Tools

### 1. **search** - Search GitHub code
Search for code, files, or content across GitHub repositories.

**Parameters:**
- `query` (required): GitHub code search query
- `page` (optional): Page number for pagination
- `per_page` (optional): Results per page (max 100)

**Example:**
```json
{
  "query": "repo:btangonan/nano-banana-runner runAnalyze.ts",
  "per_page": 10
}
```

### 2. **fetch** - Get repository information
Fetch basic information about a repository.

**Parameters:**
- `repo` (required): Repository in `owner/name` format

**Example:**
```json
{
  "repo": "btangonan/nano-banana-runner"
}
```

### 3. **list_directory** - List directory contents
Browse files and folders in a repository directory.

**Parameters:**
- `repo` (required): Repository in `owner/name` format
- `path` (required): Directory path (use `""` for root)
- `branch` (optional): Branch name (auto-detects default if omitted)
- `ref` (optional): Alternative to branch parameter

**Example:**
```json
{
  "repo": "btangonan/nano-banana-runner",
  "path": "apps/nn/src",
  "branch": "main"
}
```

**Note:** Branch is optional - server will automatically detect the repo's default branch (main/master/develop).

### 4. **read_file** - Read file contents
Read the contents of a specific file.

**Parameters:**
- `repo` (required): Repository in `owner/name` format
- `path` (required): File path
- `branch` (optional): Branch name (auto-detects default if omitted)
- `ref` (optional): Alternative to branch parameter

**Example:**
```json
{
  "repo": "btangonan/nano-banana-runner",
  "path": "apps/nn/apps/gui/src/pages/UploadAnalyze.tsx",
  "branch": "main"
}
```

**Note:** Branch is optional - server will automatically use the repo's default branch.

### 5. **get_tree** - Get repository tree structure
Get the tree structure of a repository (files and directories).

**Parameters:**
- `repo` (required): Repository in `owner/name` format
- `branch` (optional): Branch name (auto-detects default if omitted)
- `ref` (optional): Alternative to branch parameter
- `recursive` (optional): Get full recursive tree

**Example:**
```json
{
  "repo": "btangonan/nano-banana-runner",
  "branch": "main",
  "recursive": true
}
```

**Note:** Branch is optional - automatically detects the repo's default branch.

### 6. **get_commits** - Get commit history
Retrieve commit history for a repository.

**Parameters:**
- `repo` (required): Repository in `owner/name` format
- `sha` (optional): Branch/commit/tag to start from
- `page` (optional): Page number for pagination
- `per_page` (optional): Results per page (max 100)

**Example:**
```json
{
  "repo": "btangonan/nano-banana-runner",
  "sha": "main",
  "per_page": 10
}
```

### 7. **get_branches** - List repository branches
Get all branches in a repository.

**Parameters:**
- `repo` (required): Repository in `owner/name` format
- `page` (optional): Page number
- `per_page` (optional): Results per page

**Example:**
```json
{
  "repo": "btangonan/nano-banana-runner"
}
```

### 8. **create_branch** - Create a new branch
Create a new branch from an existing branch or commit.

**Parameters:**
- `repo` (required): Repository in `owner/name` format
- `branch` (required): Name for the new branch
- `from_branch` (optional): Source branch (defaults to repo default)
- `from_sha` (optional): Source commit SHA

**Example:**
```json
{
  "repo": "btangonan/nano-banana-runner",
  "branch": "feat/new-feature",
  "from_branch": "main"
}
```

### 9. **list_pull_requests** - List pull requests
List pull requests in a repository with filters.

**Parameters:**
- `repo` (required): Repository in `owner/name` format
- `state` (optional): `open`, `closed`, or `all`
- `head` (optional): Filter by head branch
- `base` (optional): Filter by base branch

**Example:**
```json
{
  "repo": "btangonan/nano-banana-runner",
  "state": "open"
}
```

### 10. **search_pull_requests** - Search pull requests
Search for pull requests using GitHub's search API.

**Parameters:**
- `query` (required): GitHub PR search query
- `repo` (optional): Limit to specific repository

**Example:**
```json
{
  "query": "is:pr repo:btangonan/nano-banana-runner state:open"
}
```

### 11. **get_pull_request** - Get PR details
Get detailed information about a specific pull request.

**Parameters:**
- `repo` (required): Repository in `owner/name` format
- `number` (required): PR number

**Example:**
```json
{
  "repo": "btangonan/nano-banana-runner",
  "number": 42
}
```

### 12. **create_pull_request** - Create a new PR
Create a pull request with optional auto-branch creation and file commits.

**Parameters:**
- `repo` (required): Repository in `owner/name` format
- `title` (required): PR title
- `body` (required): PR description
- `head` (required): Head branch name
- `base` (required): Base branch name
- `create_branch_if_missing` (optional): Auto-create head branch
- `files` (optional): Array of `{path, content}` to commit
- `commit_message` (optional): Commit message for files

**Example:**
```json
{
  "repo": "btangonan/nano-banana-runner",
  "title": "Add new feature",
  "body": "This PR adds...",
  "head": "feat/new-feature",
  "base": "main",
  "create_branch_if_missing": true,
  "files": [
    {"path": "src/feature.js", "content": "// code here"}
  ],
  "commit_message": "Add feature implementation"
}
```

### 13. **commit_files** - Commit files to branch
Add or update multiple files in a single commit.

**Parameters:**
- `repo` (required): Repository in `owner/name` format
- `branch` (required): Target branch
- `files` (required): Array of `{path, content}` objects
- `message` (required): Commit message

**Example:**
```json
{
  "repo": "btangonan/nano-banana-runner",
  "branch": "feat/new-feature",
  "files": [
    {"path": "src/file1.js", "content": "..."},
    {"path": "src/file2.js", "content": "..."}
  ],
  "message": "Add new files"
}
```

## Best Practices

### 1. **Branch Parameters are Optional**
Most tools auto-detect the repository's default branch. Only specify `branch` when you need a specific branch other than the default.

```json
// This works - auto-detects default branch
{"repo": "owner/name", "path": "README.md"}

// This also works - explicit branch
{"repo": "owner/name", "path": "README.md", "branch": "develop"}
```

### 2. **Repository Format**
Always use `owner/name` format for the `repo` parameter:
- ✅ `"btangonan/nano-banana-runner"`
- ❌ `"https://github.com/btangonan/nano-banana-runner"`

### 3. **Navigation Pattern**
To explore a repository:
1. Use `fetch` to get repository info
2. Use `list_directory` with `path: ""` to see root contents
3. Navigate deeper using `list_directory` with specific paths
4. Read files using `read_file` when you find what you need

### 4. **Search Before Browse**
Use `search` to find specific files or code patterns before manually browsing directories.

### 5. **PR Workflow**
Before creating a PR:
1. Use `list_pull_requests` or `search_pull_requests` to check for existing PRs
2. Use `get_branches` to verify branch exists or use `create_branch` to create it
3. Use `commit_files` if you need to add files to the branch
4. Use `create_pull_request` with all necessary parameters

## Error Handling Best Practices

### When You Get a 404 Error:
**DON'T give up!** A 404 means the file doesn't exist at that exact path. Instead:

1. **Search for it**: Use the `search` tool to find the file
   ```json
   {"query": "repo:owner/name filename.tsx"}
   ```

2. **Check branches**: The file might exist on a different branch
   ```json
   {"repo": "owner/name"}  // Get repo info to see default branch
   ```

3. **List directory**: Browse to find similar files
   ```json
   {"repo": "owner/name", "path": "apps/"}
   ```

4. **Ask the user**: If you can't find it, ask for the correct path or branch

**Example Recovery:**
```
❌ Got 404 for apps/nn/apps/gui/src/pages/AnalyzeCinematic.tsx
✅ Search: {"query": "repo:btangonan/nano-banana-runner AnalyzeCinematic"}
✅ Or list: {"repo": "btangonan/nano-banana-runner", "path": "apps/nn/apps/gui/src/pages"}
✅ Or ask: "I couldn't find AnalyzeCinematic.tsx - do you know the correct path?"
```

### Other Common Errors:
- **403 Forbidden**: Repository not in whitelist or authentication issue
- **422 Invalid**: Check parameter format (use `owner/name` for repo)
- **Rate Limited**: Wait a moment and retry

## Security & Rate Limits

- This server has repository whitelist: `btangonan/*` (your repositories only)
- Rate limited: 100 PR operations per 10 minutes
- All operations are audited and logged
- Cannot access private repositories outside the whitelist

## Example Workflow

**Scenario: Find and read the image analyzer code**

```json
// Step 1: Search for the file
{"query": "repo:btangonan/nano-banana-runner runAnalyze.ts"}

// Step 2: Navigate to the directory
{"repo": "btangonan/nano-banana-runner", "path": "apps/nn/apps/gui/src/pages"}

// Step 3: Read the file
{"repo": "btangonan/nano-banana-runner", "path": "apps/nn/apps/gui/src/pages/UploadAnalyze.tsx"}
```

**Scenario: Create a PR with new code**

```json
// Step 1: Check for existing PRs
{"repo": "btangonan/nano-banana-runner", "state": "open"}

// Step 2: Create branch and commit files in one PR
{
  "repo": "btangonan/nano-banana-runner",
  "title": "Add new analyzer feature",
  "body": "Implements new image analysis feature",
  "head": "feat/new-analyzer",
  "base": "main",
  "create_branch_if_missing": true,
  "files": [
    {"path": "src/newAnalyzer.ts", "content": "// implementation"}
  ],
  "commit_message": "Add new analyzer implementation"
}
```

---

**Remember:**
- Branch parameters are optional - the server auto-detects the default branch
- Always use `owner/name` format for repositories
- Check for existing PRs before creating new ones
- All operations are logged and rate-limited for security

Now you can browse GitHub repositories, read code, and create pull requests using these tools!
