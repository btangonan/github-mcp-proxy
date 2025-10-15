/**
 * Write Tools Module
 *
 * Tool handlers for GitHub write operations:
 * - create_pull_request: Create a new pull request
 * - create_branch: Create a new branch
 * - commit_files: Commit files to a branch
 *
 * @module lib/tools/write-tools
 */

/**
 * Create a new pull request in a repository
 * Automatically checks for existing PRs, can create branches and commit files
 * @param {Object} args - PR creation arguments
 * @param {string} args.repo - Repository in format owner/repo
 * @param {string} args.title - PR title
 * @param {string} args.body - PR description
 * @param {string} args.head - Branch containing changes
 * @param {string} [args.base='main'] - Branch to merge into
 * @param {boolean} [args.draft=false] - Create as draft PR
 * @param {boolean} [args.create_branch_if_missing=false] - Create head branch if it doesn't exist
 * @param {Array} [args.files] - Files to commit before creating PR
 * @param {string} [args.commit_message] - Commit message for files
 * @returns {Promise<Object>} MCP response with PR details
 */
async function handleCreatePullRequest(args, { config, validateRepoFormat, validateTitle, validateBody, validateBranch, assert, isRepoWhitelisted, checkPRRateLimit, githubRequest, auditLog }) {
  // Validate PR creation is enabled
  assert(config.prEnabled, 'PR creation is disabled');

  // Parse and validate repository
  const [owner, repo] = validateRepoFormat(args.repo);

  // Check whitelist
  assert(
    isRepoWhitelisted(owner, repo),
    `Repository ${owner}/${repo} is not whitelisted for PR creation`
  );

  // Check rate limit
  const rateLimitKey = `${owner}/${repo}`;
  assert(
    checkPRRateLimit(rateLimitKey),
    `PR rate limit exceeded for ${owner}/${repo}. Max ${config.prRateLimitMax} PRs per ${config.prRateLimitWindow / 60000} minutes`
  );

  // Validate required fields with size limits
  const title = validateTitle(args.title);
  const body = validateBody(args.body);
  const base = validateBranch(args.base || 'main');
  const head = validateBranch(args.head);
  assert(head && head !== base, 'Head branch is required and must differ from base');

  // Validate PR template if required
  if (config.prTemplateRequired && !body.includes('[ChatGPT]')) {
    throw new Error('PR body must include [ChatGPT] tag when template is required');
  }

  // Always check for existing open PRs first to avoid duplicates
  try {
    const existingPRs = await githubRequest(`/repos/${owner}/${repo}/pulls?head=${owner}:${head}&base=${base}&state=open`);
    if (existingPRs && existingPRs.length > 0) {
      const existingPR = existingPRs[0];

      await auditLog('PR_ALREADY_EXISTS', {
        repo: `${owner}/${repo}`,
        base,
        head,
        existingPRNumber: existingPR.number,
        existingPRUrl: existingPR.html_url
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              exists: true,
              message: `PR already exists from ${head} to ${base}`,
              pr: {
                number: existingPR.number,
                url: existingPR.html_url,
                title: existingPR.title,
                state: existingPR.state,
                draft: existingPR.draft,
                created_at: existingPR.created_at
              }
            })
          }
        ]
      };
    }
  } catch (prCheckError) {
    console.warn('⚠️ Could not check for existing PRs:', prCheckError.message);
    // Continue with PR creation if check fails
  }

  // Log the attempt
  await auditLog('PR_CREATE_ATTEMPT', {
    repo: `${owner}/${repo}`,
    base,
    head,
    title,
    bodyLength: body.length,
    createBranchIfMissing: args.create_branch_if_missing || false,
    hasFilesToCommit: args.files ? args.files.length : 0
  });

  try {
    // URL-encode branch names to handle slashes
    const encodedBase = encodeURIComponent(base);
    const encodedHead = encodeURIComponent(head);

    // Check if base branch exists
    try {
      await githubRequest(`/repos/${owner}/${repo}/branches/${encodedBase}`);
    } catch (baseError) {
      throw new Error(`Base branch '${base}' not found in ${owner}/${repo}`);
    }

    // Check if head branch exists, create if needed and allowed
    let headExists = false;
    let branchCreated = false;

    try {
      await githubRequest(`/repos/${owner}/${repo}/branches/${encodedHead}`);
      headExists = true;
    } catch (headError) {
      if (headError.message.includes('404') && args.create_branch_if_missing === true) {
        // Create the branch from base
        console.log(`🔄 Head branch '${head}' not found, creating from '${base}'...`);

        // Import handleCreateBranch dynamically to avoid circular dependencies
        const { handleCreateBranch } = require('./write-tools');
        try {
          const branchResult = await handleCreateBranch({
            repo: args.repo,
            branch: head,
            from: base
          }, { config, validateRepoFormat, validateBranch, assert, isRepoWhitelisted, githubRequest, auditLog });

          const branchResponse = JSON.parse(branchResult.content[0].text);
          if (branchResponse.success) {
            headExists = true;
            branchCreated = true;
            console.log(`✅ Branch '${head}' created successfully`);
          }
        } catch (createError) {
          throw new Error(`Failed to create branch '${head}': ${createError.message}`);
        }
      } else if (!args.create_branch_if_missing) {
        throw new Error(`Head branch '${head}' not found. Set create_branch_if_missing: true to auto-create it`);
      } else {
        throw headError;
      }
    }

    // If files are provided, commit them to the head branch
    if (args.files && args.files.length > 0) {
      if (!headExists) {
        throw new Error(`Cannot commit files: branch '${head}' does not exist`);
      }

      console.log(`📝 Committing ${args.files.length} file(s) to branch '${head}'...`);

      // Import handleCommitFiles dynamically
      const { handleCommitFiles } = require('./write-tools');
      try {
        const commitResult = await handleCommitFiles({
          repo: args.repo,
          branch: head,
          files: args.files,
          message: args.commit_message || `Add files for PR: ${title}`
        }, { config, validateRepoFormat, validateBranch, validateFiles, assert, isRepoWhitelisted, githubRequest, auditLog });

        const commitResponse = JSON.parse(commitResult.content[0].text);
        if (commitResponse.success) {
          console.log(`✅ Files committed successfully: ${commitResponse.sha}`);
        }
      } catch (commitError) {
        // If branch was just created, we might want to clean it up
        throw new Error(`Failed to commit files to '${head}': ${commitError.message}`);
      }
    }

    // Create the pull request
    const prData = {
      title: `[ChatGPT] ${title}`,
      body: body || `This pull request was created by ChatGPT via MCP.\n\nHead: ${head}\nBase: ${base}`,
      head,
      base,
      draft: args.draft === true
    };

    const response = await githubRequest(
      `/repos/${owner}/${repo}/pulls`,
      prData,
      {},
      'POST'
    );

    // Log successful creation
    await auditLog('PR_CREATED', {
      repo: `${owner}/${repo}`,
      prNumber: response.number,
      prUrl: response.html_url,
      base,
      head,
      title,
      branchCreated,
      filesCommitted: args.files ? args.files.length : 0
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            branch_created: branchCreated,
            files_committed: args.files ? args.files.length : 0,
            pr: {
              number: response.number,
              url: response.html_url,
              title: response.title,
              state: response.state,
              draft: response.draft,
              created_at: response.created_at
            }
          })
        }
      ]
    };
  } catch (error) {
    // Log failure
    await auditLog('PR_CREATE_FAILED', {
      repo: `${owner}/${repo}`,
      base,
      head,
      error: error.message
    });

    // Provide helpful error messages
    if (error.message.includes('404') && !error.message.includes('branch')) {
      throw new Error(`Repository or resource not found: ${owner}/${repo}`);
    }
    if (error.message.includes('422')) {
      throw new Error(`Cannot create PR: ${error.message}. This usually means the PR already exists or there are no differences between branches`);
    }
    if (error.message.includes('403')) {
      throw new Error(`Permission denied. Ensure the GitHub token has 'pull_request:write' permission for ${owner}/${repo}`);
    }
    throw error;
  }
}

/**
 * Create a new branch in a repository
 * Returns success if branch already exists (idempotent)
 * @param {Object} args - Branch creation arguments
 * @param {string} args.repo - Repository in format owner/repo
 * @param {string} args.branch - Name for the new branch
 * @param {string} [args.from] - Source branch or commit SHA to branch from
 * @returns {Promise<Object>} MCP response with branch details
 */
async function handleCreateBranch(args, { config, validateRepoFormat, validateBranch, assert, isRepoWhitelisted, githubRequest, auditLog }) {
  const [owner, repo] = validateRepoFormat(args.repo);
  const branchName = validateBranch(args.branch);
  assert(branchName, 'Branch name is required');

  // Check whitelist for branch creation (reuse central whitelist)
  assert(isRepoWhitelisted(owner, repo), `Repository ${owner}/${repo} is not whitelisted for branch creation`);

  try {
    // URL-encode branch names to handle slashes (e.g., feat/branch-name)
    const encodedBranchName = encodeURIComponent(branchName);

    // First check if branch already exists (idempotent)
    try {
      const existingBranch = await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${encodedBranchName}`);
      if (existingBranch && existingBranch.object && existingBranch.object.sha) {
        // Branch already exists, return success (idempotent)
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                exists: true,
                branch: branchName,
                sha: existingBranch.object.sha,
                message: `Branch '${branchName}' already exists`,
                url: `https://github.com/${owner}/${repo}/tree/${branchName}`
              })
            }
          ]
        };
      }
    } catch (checkError) {
      // Branch doesn't exist, proceed with creation
      if (checkError.statusCode !== 404) {
        throw checkError;
      }
    }

    // Get the base branch (default to repository's default branch)
    const baseBranch = args.from || 'main';
    const encodedBaseBranch = encodeURIComponent(baseBranch);

    // Get the SHA of the base branch
    let baseSha;
    try {
      const baseBranchData = await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${encodedBaseBranch}`);
      baseSha = baseBranchData.object.sha;
    } catch (error) {
      if (error.statusCode === 404) {
        // Base branch not found - fallback to repository's default branch
        const repoInfo = await githubRequest(`/repos/${owner}/${repo}`);
        const defaultBranch = repoInfo.default_branch || 'main';
        const encodedDefaultBranch = encodeURIComponent(defaultBranch);
        const defaultBranchData = await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${encodedDefaultBranch}`);
        baseSha = defaultBranchData.object.sha;
        console.log(`⚠️ Base branch '${baseBranch}' not found, using default branch '${defaultBranch}' instead`);
      } else {
        throw error;
      }
    }

    // Create the new branch
    const response = await githubRequest(
      `/repos/${owner}/${repo}/git/refs`,
      {
        ref: `refs/heads/${branchName}`,
        sha: baseSha
      },
      {},
      'POST'
    );

    // Log branch creation for audit
    await auditLog('BRANCH_CREATED', {
      repo: `${owner}/${repo}`,
      branch: branchName,
      from: baseBranch,
      sha: baseSha
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            branch: branchName,
            from: baseBranch,
            sha: baseSha,
            message: `Successfully created branch '${branchName}' from '${baseBranch}'`,
            url: `https://github.com/${owner}/${repo}/tree/${branchName}`
          })
        }
      ]
    };
  } catch (error) {
    // Log branch creation failure
    await auditLog('BRANCH_CREATE_FAILED', {
      repo: `${owner}/${repo}`,
      branch: branchName,
      error: error.message
    });

    if (error.statusCode === 404) {
      throw new Error(`Repository ${owner}/${repo} or base branch not found: ${error.message}`);
    }
    throw new Error(`Failed to create branch: ${error.message}`);
  }
}

/**
 * Commit files to a branch in a repository
 * @param {Object} args - Commit arguments
 * @param {string} args.repo - Repository in format owner/repo
 * @param {string} args.branch - Branch to commit to
 * @param {string} args.message - Commit message
 * @param {Array} args.files - Array of files to commit
 * @returns {Promise<Object>} MCP response with commit details
 */
async function handleCommitFiles(args, { config, validateRepoFormat, validateBranch, validateFiles, assert, isRepoWhitelisted, githubRequest, auditLog }) {
  const [owner, repo] = validateRepoFormat(args.repo);
  const branchName = validateBranch(args.branch);
  assert(branchName, 'Branch name is required');
  assert(args.message, 'Commit message is required');

  // Validate files with size limits
  const validatedFiles = validateFiles(args.files);

  // Check whitelist
  assert(isRepoWhitelisted(owner, repo), `Repository ${owner}/${repo} is not whitelisted for file commits`);

  try {
    // URL-encode branch name to handle slashes
    const encodedBranchName = encodeURIComponent(branchName);

    // Get the current branch SHA
    const branchRef = await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${encodedBranchName}`);
    const currentSha = branchRef.object.sha;

    // Get the current tree
    const currentCommit = await githubRequest(`/repos/${owner}/${repo}/git/commits/${currentSha}`);
    const baseTreeSha = currentCommit.tree.sha;

    // Create blobs for each file (use validated files)
    const blobs = await Promise.all(validatedFiles.map(async file => {
      const content = file.encoding === 'base64' ? file.content : Buffer.from(file.content).toString('base64');
      const blob = await githubRequest(
        `/repos/${owner}/${repo}/git/blobs`,
        {
          content: content,
          encoding: 'base64'
        },
        {},
        'POST'
      );
      return {
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha
      };
    }));

    // Create a new tree with the files
    const newTree = await githubRequest(
      `/repos/${owner}/${repo}/git/trees`,
      {
        base_tree: baseTreeSha,
        tree: blobs
      },
      {},
      'POST'
    );

    // Create the commit
    const newCommit = await githubRequest(
      `/repos/${owner}/${repo}/git/commits`,
      {
        message: args.message,
        tree: newTree.sha,
        parents: [currentSha]
      },
      {},
      'POST'
    );

    // Update the branch reference
    await githubRequest(
      `/repos/${owner}/${repo}/git/refs/heads/${encodedBranchName}`,
      {
        sha: newCommit.sha
      },
      {},
      'PATCH'
    );

    await auditLog('FILES_COMMITTED', {
      repo: `${owner}/${repo}`,
      branch: branchName,
      fileCount: validatedFiles.length,
      sha: newCommit.sha
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            branch: branchName,
            commit: newCommit.sha,
            files: validatedFiles.map(f => f.path),
            message: `Successfully committed ${validatedFiles.length} file(s) to '${branchName}'`,
            url: `https://github.com/${owner}/${repo}/commit/${newCommit.sha}`
          })
        }
      ]
    };
  } catch (error) {
    await auditLog('COMMIT_FILES_FAILED', {
      repo: `${owner}/${repo}`,
      branch: branchName,
      error: error.message
    });
    throw error;
  }
}

module.exports = {
  handleCreatePullRequest,
  handleCreateBranch,
  handleCommitFiles
};
