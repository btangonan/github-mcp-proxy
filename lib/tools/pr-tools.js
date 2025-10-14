/**
 * PR Tools Module
 *
 * Tool handlers for GitHub pull request operations:
 * - list_pull_requests: List PRs in a repository
 * - search_pull_requests: Search PRs using GitHub search API
 * - get_pull_request: Get detailed PR information
 * - update_pull_request: Update PR metadata, state, and reviewers
 * - merge_pull_request: Merge a PR with safety checks
 * - get_pr_mergeability: Check if a PR is mergeable
 * - get_checks_for_sha: Get CI/CD checks for a commit
 *
 * @module lib/tools/pr-tools
 */

/**
 * Helper: Get combined status and checks summary for a commit SHA
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} sha - Commit SHA
 * @param {Object} context - Tool context with githubRequest
 * @returns {Promise<Object>} Status and checks summary
 */
async function getChecksSummary(owner, repo, sha, { githubRequest }) {
  // Combined status (legacy statuses)
  const status = await githubRequest(`/repos/${owner}/${repo}/commits/${sha}/status`);
  // GitHub Checks API (requires proper Accept header)
  const checks = await githubRequest(
    `/repos/${owner}/${repo}/commits/${sha}/check-runs`,
    {},
    { Accept: 'application/vnd.github+json' },
    'GET'
  );

  const failingStatuses = (status.statuses || [])
    .filter(s => s.state !== 'success')
    .map(s => s.context);

  const failingChecks = (checks.check_runs || [])
    .filter(c => ['failure','timed_out','cancelled','action_required'].includes(c.conclusion))
    .map(c => c.name);

  const message = (failingStatuses.length === 0 && failingChecks.length === 0)
    ? 'Merge blocked by protections or review requirements.'
    : `Failing: ${[...failingStatuses, ...failingChecks].join(', ')}`;

  return { status, checks, message };
}

/**
 * Helper: Wait for GitHub to compute PR.mergeable when it's null
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - PR number
 * @param {Object} context - Tool context with githubRequest
 * @param {number} attempts - Number of retry attempts
 * @returns {Promise<Object>} PR object with computed mergeable status
 */
async function waitForMergeable(owner, repo, prNumber, { githubRequest }, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    const pr = await (async () => {
      for (let i = 0; i < 5; i++) {
        const p = await githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`);
        if (p.mergeable !== null) return p;
        await new Promise(r => setTimeout(r, 800));
      }
      return githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`);
    })();
    if (pr.mergeable !== null) return pr;
    await new Promise(r => setTimeout(r, 800));
  }
  // Final attempt
  return githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`);
}

/**
 * List pull requests in a repository
 * @param {Object} args - PR listing arguments
 * @param {string} args.repo - Repository in format owner/repo
 * @param {string} [args.state='open'] - PR state: open, closed, all
 * @param {string} [args.base] - Filter by base branch
 * @param {string} [args.head] - Filter by head branch
 * @param {string} [args.sort] - Sort by: created, updated, popularity, long-running
 * @param {string} [args.direction] - Sort direction: asc, desc
 * @param {number} [args.limit=30] - Max results per page
 * @param {number} [args.page=1] - Page number
 * @returns {Promise<Object>} MCP response with PR list
 */
async function handleListPullRequests(args, { validateRepoFormat, validateBranch, githubRequest }) {
  const [owner, repo] = validateRepoFormat(args.repo);

  // Build query parameters
  const params = {
    per_page: args.limit || 30,
    page: args.page || 1
  };

  // Add optional filters
  if (args.state) params.state = args.state; // open, closed, all
  if (args.base) params.base = validateBranch(args.base);
  if (args.head) params.head = args.head.includes(':') ? args.head : `${owner}:${validateBranch(args.head)}`;
  if (args.sort) params.sort = args.sort; // created, updated, popularity, long-running
  if (args.direction) params.direction = args.direction; // asc, desc

  try {
    const response = await githubRequest(`/repos/${owner}/${repo}/pulls`, params);

    const pullRequests = response.map(pr => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      draft: pr.draft,
      head: pr.head.ref,
      base: pr.base.ref,
      url: pr.html_url,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      author: pr.user.login,
      mergeable_state: pr.mergeable_state
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            repository: `${owner}/${repo}`,
            pull_requests: pullRequests,
            page: params.page,
            per_page: params.per_page
          })
        }
      ]
    };
  } catch (error) {
    if (error.statusCode === 404) {
      throw new Error(`Repository ${owner}/${repo} not found or you don't have access`);
    }
    throw error;
  }
}

/**
 * Search pull requests using GitHub's search API
 * @param {Object} args - Search arguments
 * @param {string} args.query - Search query (is:pr automatically prepended)
 * @param {string} [args.repo] - Optional: limit to specific repo
 * @param {string} [args.sort] - Sort by: comments, reactions, created, updated
 * @param {string} [args.order] - Sort order: asc, desc
 * @param {number} [args.limit=30] - Max results
 * @param {number} [args.page=1] - Page number
 * @returns {Promise<Object>} MCP response with search results
 */
async function handleSearchPullRequests(args, { safeString, assert, githubRequest }) {
  const query = safeString(args.query, 500);
  assert(query.length > 0, 'Search query cannot be empty');

  // Automatically add is:pr to the query if not present
  const prQuery = query.includes('is:pr') ? query : `is:pr ${query}`;

  const params = {
    q: prQuery,
    per_page: args.limit || 30,
    page: args.page || 1
  };

  // Add optional sort and order
  if (args.sort) params.sort = args.sort; // comments, reactions, created, updated
  if (args.order) params.order = args.order; // asc, desc

  try {
    const response = await githubRequest('/search/issues', params);

    const pullRequests = response.items.map(pr => ({
      number: pr.number,
      title: pr.title,
      repository: pr.repository_url.replace('https://api.github.com/repos/', ''),
      state: pr.state,
      draft: pr.draft || false,
      url: pr.html_url,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      author: pr.user.login,
      labels: pr.labels.map(l => l.name),
      comments: pr.comments
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            query: prQuery,
            total_count: response.total_count,
            pull_requests: pullRequests,
            page: params.page,
            per_page: params.per_page
          })
        }
      ]
    };
  } catch (error) {
    if (error.statusCode === 422) {
      throw new Error(`Invalid search query: ${query}. Check GitHub search syntax.`);
    }
    throw error;
  }
}

/**
 * Get detailed information about a specific pull request
 * @param {Object} args - PR query arguments
 * @param {string} args.repo - Repository in format owner/repo
 * @param {number} args.prNumber - Pull request number
 * @param {boolean} [args.include_commits] - Include commit list
 * @param {boolean} [args.include_files] - Include changed files
 * @param {boolean} [args.include_reviews] - Include reviews
 * @returns {Promise<Object>} MCP response with PR details
 */
async function handleGetPullRequest(args, { validateRepoFormat, assert, githubRequest }) {
  const [owner, repo] = validateRepoFormat(args.repo);
  const prNumber = parseInt(args.prNumber);
  assert(!isNaN(prNumber) && prNumber > 0, 'PR number must be a positive integer');

  try {
    const pr = await githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`);

    // Get additional details if requested
    let commits = null;
    let files = null;
    let reviews = null;

    if (args.include_commits) {
      const commitsResponse = await githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}/commits`, {
        per_page: 100
      });
      commits = commitsResponse.map(c => ({
        sha: c.sha,
        message: c.commit.message,
        author: c.commit.author.name,
        date: c.commit.author.date
      }));
    }

    if (args.include_files) {
      const filesResponse = await githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}/files`, {
        per_page: 100
      });
      files = filesResponse.map(f => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes
      }));
    }

    if (args.include_reviews) {
      const reviewsResponse = await githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
        per_page: 100
      });
      reviews = reviewsResponse.map(r => ({
        user: r.user.login,
        state: r.state,
        submitted_at: r.submitted_at,
        body: r.body
      }));
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            number: pr.number,
            title: pr.title,
            body: pr.body,
            state: pr.state,
            draft: pr.draft,
            head: {
              ref: pr.head.ref,
              sha: pr.head.sha,
              repo: pr.head.repo ? pr.head.repo.full_name : null
            },
            base: {
              ref: pr.base.ref,
              sha: pr.base.sha,
              repo: pr.base.repo.full_name
            },
            url: pr.html_url,
            created_at: pr.created_at,
            updated_at: pr.updated_at,
            closed_at: pr.closed_at,
            merged_at: pr.merged_at,
            merge_commit_sha: pr.merge_commit_sha,
            author: pr.user.login,
            assignees: pr.assignees.map(a => a.login),
            reviewers: pr.requested_reviewers.map(r => r.login),
            labels: pr.labels.map(l => ({ name: l.name, color: l.color })),
            milestone: pr.milestone ? pr.milestone.title : null,
            mergeable: pr.mergeable,
            mergeable_state: pr.mergeable_state,
            merged: pr.merged,
            merged_by: pr.merged_by ? pr.merged_by.login : null,
            comments: pr.comments,
            review_comments: pr.review_comments,
            commits: pr.commits,
            additions: pr.additions,
            deletions: pr.deletions,
            changed_files: pr.changed_files,
            ...(commits && { commit_details: commits }),
            ...(files && { file_details: files }),
            ...(reviews && { review_details: reviews })
          })
        }
      ]
    };
  } catch (error) {
    if (error.statusCode === 404) {
      throw new Error(`Pull request #${prNumber} not found in ${owner}/${repo}`);
    }
    throw error;
  }
}

/**
 * Update a pull request's metadata, state, and reviewers
 * @param {Object} args - Update arguments
 * @param {string} args.repo - Repository in format owner/repo
 * @param {number} args.prNumber - Pull request number
 * @param {string} [args.title] - New title
 * @param {string} [args.body] - New description
 * @param {string} [args.state] - New state: open, closed
 * @param {boolean} [args.draft] - Draft state (false to mark ready for review)
 * @param {string} [args.base] - Change base branch
 * @param {boolean} [args.maintainer_can_modify] - Allow maintainers to modify
 * @param {Array<string>} [args.reviewers] - Logins to request review from
 * @returns {Promise<Object>} MCP response with update results
 */
async function handleUpdatePullRequest(args, { config, validateRepoFormat, validateTitle, validateBody, validateBranch, assert, isRepoWhitelisted, githubRequest, auditLog }) {
  assert(config.prUpdateEnabled, 'PR updates are disabled');
  const [owner, repo] = validateRepoFormat(args.repo);
  assert(isRepoWhitelisted(owner, repo), `Repo ${owner}/${repo} not whitelisted for PR updates`);

  const prNumber = parseInt(args.prNumber);
  assert(!isNaN(prNumber) && prNumber > 0, 'Valid prNumber required');

  // Handle draft toggle using GitHub's dedicated endpoints
  let draftUpdated = false;
  if (typeof args.draft === 'boolean') {
    if (args.draft === false) {
      // Mark as ready for review
      await githubRequest(
        `/repos/${owner}/${repo}/pulls/${prNumber}/ready_for_review`,
        {},
        {},
        'POST'
      );
      draftUpdated = true;
    } else {
      // Convert to draft
      await githubRequest(
        `/repos/${owner}/${repo}/pulls/${prNumber}/convert_to_draft`,
        {},
        {},
        'POST'
      );
      draftUpdated = true;
    }
  }

  // PATCH for other fields (title, body, base, state)
  const patch = {};
  if (args.title) patch.title = validateTitle(args.title);
  if (args.body) patch.body = validateBody(args.body);
  if (args.state) patch.state = args.state; // "open" | "closed"
  if (args.base) patch.base = validateBranch(args.base);
  if (typeof args.maintainer_can_modify === 'boolean') patch.maintainer_can_modify = args.maintainer_can_modify;

  let updated = null;
  if (Object.keys(patch).length > 0) {
    updated = await githubRequest(
      `/repos/${owner}/${repo}/pulls/${prNumber}`,
      patch,
      {},
      'PATCH'
    );
  } else {
    // If only draft was updated, fetch current PR state
    updated = await githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`);
  }

  // Optional: reviewers
  let reviewersAdded = null;
  if (Array.isArray(args.reviewers) && args.reviewers.length > 0) {
    reviewersAdded = await githubRequest(
      `/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`,
      { reviewers: args.reviewers },
      {},
      'POST'
    );
  }

  await auditLog('PR_UPDATED', {
    repo: `${owner}/${repo}`,
    prNumber,
    fields: Object.keys(patch),
    reviewers: args.reviewers?.length || 0
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: true,
          pr: {
            number: updated.number,
            title: updated.title,
            draft: updated.draft,
            state: updated.state,
            base: updated.base.ref
          },
          reviewers_added: reviewersAdded ? reviewersAdded.requested_reviewers.map(r => r.login) : []
        })
      }
    ]
  };
}

/**
 * Merge a pull request with safety checks and audit logging
 * @param {Object} args - Merge arguments
 * @param {string} args.repo - Repository in format owner/repo
 * @param {number} args.prNumber - Pull request number
 * @param {string} args.sha - Head SHA guard for safety (required)
 * @param {string} [args.merge_method='squash'] - Merge method: merge, squash, rebase
 * @param {string} [args.commit_title] - Optional merge commit title
 * @param {string} [args.commit_message] - Optional merge commit message
 * @param {boolean} [args.delete_branch=false] - Delete head branch after merge
 * @returns {Promise<Object>} MCP response with merge results
 */
async function handleMergePullRequest(args, { config, validateRepoFormat, safeString, assert, isRepoWhitelisted, checkRateLimitCustom, githubRequest, auditLog, getChecksSummary, waitForMergeable, prMergeRateLimiter }) {
  assert(config.prMergeEnabled, 'PR merge is disabled');
  const [owner, repo] = validateRepoFormat(args.repo);
  assert(isRepoWhitelisted(owner, repo), `Repo ${owner}/${repo} not whitelisted for PR merge`);

  // rate limit merges separately
  const key = `${owner}/${repo}`;
  assert(
    checkRateLimitCustom(
      config.prMergeRateLimitWindow,
      config.prMergeRateLimitMax,
      prMergeRateLimiter,
      'merge',
      key
    ),
    `Merge rate limit exceeded for ${owner}/${repo}`
  );

  const prNumber = parseInt(args.prNumber);
  assert(!isNaN(prNumber) && prNumber > 0, 'Valid prNumber required');

  const mergeMethod = (args.merge_method || 'squash');
  assert(['merge', 'squash', 'rebase'].includes(mergeMethod), 'Invalid merge_method');

  const pr = await waitForMergeable(owner, repo, prNumber, { githubRequest });
  const headRef = pr.head.ref;
  const headSha = pr.head.sha;

  // SHA guard for safety (now required by schema)
  assert(args.sha, 'SHA is required for merge safety');
  assert(args.sha === headSha, `Head SHA mismatch. Expected ${args.sha} but PR head is ${headSha}. Fetch latest and retry.`);

  // Explicit null check - GitHub may still be computing mergeable status
  if (pr.mergeable === null) {
    await auditLog('PR_MERGE_BLOCKED', {
      repo: `${owner}/${repo}`,
      prNumber,
      mergeable_state: pr.mergeable_state,
      reason: 'mergeable status still computing'
    });
    throw new Error('PR mergeable status is still being computed by GitHub. Please try again in a few moments.');
  }

  // Check if mergeable
  if (pr.mergeable !== true) {
    const checks = await getChecksSummary(owner, repo, headSha, { githubRequest });
    await auditLog('PR_MERGE_BLOCKED', {
      repo: `${owner}/${repo}`,
      prNumber,
      mergeable_state: pr.mergeable_state,
      checks
    });
    throw new Error(`PR not mergeable: ${pr.mergeable_state}. ${checks.message}`);
  }

  const body = { merge_method: mergeMethod };
  if (args.commit_title) body.commit_title = safeString(args.commit_title, 256);
  if (args.commit_message) body.commit_message = safeString(args.commit_message, 5000);
  if (args.sha) body.sha = args.sha;

  let mergeResp;
  try {
    mergeResp = await githubRequest(
      `/repos/${owner}/${repo}/pulls/${prNumber}/merge`,
      body,
      {},
      'PUT'
    );
  } catch (e) {
    await auditLog('PR_MERGE_FAILED', { repo: `${owner}/${repo}`, prNumber, error: e.message });
    throw e;
  }

  // Optional branch delete (non-fatal), avoid deleting base branch and default branch
  let branchDeleted = false;
  if (args.delete_branch === true && headRef !== pr.base.ref) {
    try {
      const repoInfo = await githubRequest(`/repos/${owner}/${repo}`);
      if (headRef === repoInfo.default_branch) {
        throw new Error(`Refusing to delete default branch '${headRef}'`);
      }
    } catch (_e) {
      // proceed if repo info unavailable
    }
    try {
      await githubRequest(
        `/repos/${owner}/${repo}/git/refs/heads/${headRef}`,
        {},
        {},
        'DELETE'
      );
      branchDeleted = true;
    } catch (e) {
      // ignore delete failures
    }
  }

  await auditLog('PR_MERGED', {
    repo: `${owner}/${repo}`,
    prNumber,
    method: mergeMethod,
    sha: headSha,
    branchDeleted
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: true,
          merged: mergeResp.merged,
          message: mergeResp.message,
          sha: mergeResp.sha,
          commit_url: mergeResp.commit_url,
          branch_deleted: branchDeleted
        })
      }
    ]
  };
}

/**
 * Get PR mergeability status with checks summary
 * @param {Object} args - Mergeability check arguments
 * @param {string} args.repo - Repository in format owner/repo
 * @param {number} args.prNumber - Pull request number
 * @returns {Promise<Object>} MCP response with mergeability details
 */
async function handleGetPRMergeability(args, { validateRepoFormat, assert, githubRequest, getChecksSummary }) {
  const [owner, repo] = validateRepoFormat(args.repo);
  const prNumber = parseInt(args.prNumber);
  assert(!isNaN(prNumber) && prNumber > 0, 'Valid prNumber required');
  const pr = await githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`);
  const checks = await getChecksSummary(owner, repo, pr.head.sha, { githubRequest });
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          number: pr.number,
          mergeable: pr.mergeable,
          mergeable_state: pr.mergeable_state,
          head_sha: pr.head.sha,
          base: pr.base.ref,
          head: pr.head.ref,
          checks: { message: checks.message }
        })
      }
    ]
  };
}

/**
 * Get checks and statuses for a commit SHA
 * @param {Object} args - Checks query arguments
 * @param {string} args.repo - Repository in format owner/repo
 * @param {string} args.sha - Commit SHA (minimum 7 characters)
 * @returns {Promise<Object>} MCP response with checks and statuses
 */
async function handleGetChecksForSha(args, { validateRepoFormat, safeString, assert, githubRequest }) {
  const [owner, repo] = validateRepoFormat(args.repo);
  const sha = safeString(args.sha, 100);
  assert(sha && sha.length >= 7, 'Valid sha required');

  const status = await githubRequest(`/repos/${owner}/${repo}/commits/${sha}/status`);
  const checks = await githubRequest(
    `/repos/${owner}/${repo}/commits/${sha}/check-runs`,
    {},
    { Accept: 'application/vnd.github+json' },
    'GET'
  );

  const failingStatuses = (status.statuses || []).filter(s => s.state !== 'success').map(s => s.context);
  const failingChecks = (checks.check_runs || []).filter(c => ['failure','timed_out','cancelled','action_required'].includes(c.conclusion)).map(c => c.name);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          sha,
          state: status.state,
          total_statuses: (status.statuses || []).length,
          total_checks: (checks.check_runs || []).length,
          failing: [...failingStatuses, ...failingChecks],
          details_url: status.repository?.html_url ? `${status.repository.html_url}/commit/${sha}/checks` : undefined
        })
      }
    ]
  };
}

module.exports = {
  getChecksSummary,
  waitForMergeable,
  handleListPullRequests,
  handleSearchPullRequests,
  handleGetPullRequest,
  handleUpdatePullRequest,
  handleMergePullRequest,
  handleGetPRMergeability,
  handleGetChecksForSha
};
