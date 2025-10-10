// PATCH: create_branch robustness + axios status normalization
// (This patch injects an improved handleCreateBranch and preserves the rest of the file content.)

/* BEGIN PATCH: robust create_branch */
function __patched_handleCreateBranchFactory(githubRequest, assert, validateRepoFormat, validateBranch, isRepoWhitelisted, auditLog) {
  return async function handleCreateBranch(args) {
    const [owner, repo] = validateRepoFormat(args.repo);
    const branchName = validateBranch(args.branch);
    assert(branchName, 'Branch name is required');
    assert(isRepoWhitelisted(owner, repo), `Repository ${owner}/${repo} is not whitelisted for branch creation`);

    // 0) Normalize axios status shape everywhere this handler inspects errors
    const statusOf = (e) => e?.statusCode || e?.response?.status;

    // 1) Idempotency: fast-path if ref exists
    try {
      const existing = await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${branchName}`);
      if (existing?.object?.sha) {
        await auditLog('BRANCH_EXISTS', { repo: `${owner}/${repo}`, branch: branchName, sha: existing.object.sha });
        return { content: [{ type: 'text', text: JSON.stringify({
          success: true, exists: true, created: false, branch: branchName, sha: existing.object.sha,
          message: `Branch '${branchName}' already exists`,
          url: `https://github.com/${owner}/${repo}/tree/${branchName}`
        }) }] };
      }
    } catch (e) {
      if (statusOf(e) !== 404) throw e; // non-404 is real error
    }

    // 2) Resolve baseSha from args.from or default branch with robust fallbacks
    let baseSha = null;
    let resolvedFrom = args.from || null;

    const getShaFromHeads = async (b) => {
      const r = await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${b}`);
      return r?.object?.sha;
    };
    const getShaFromBranches = async (b) => {
      const r = await githubRequest(`/repos/${owner}/${repo}/branches/${b}`);
      return r?.commit?.sha;
    };

    if (args.from) {
      try { baseSha = await getShaFromHeads(args.from); } catch (e) { if (statusOf(e) !== 404) throw e; }
    }

    if (!baseSha) {
      const repoInfo = await githubRequest(`/repos/${owner}/${repo}`);
      const def = repoInfo?.default_branch || 'main';
      try { baseSha = await getShaFromHeads(def); } catch (e) {
        if (statusOf(e) === 404) { baseSha = await getShaFromBranches(def); } else { throw e; }
      }
      if (baseSha) {
        if (args.from) await auditLog('BRANCH_BASE_FALLBACK', { repo: `${owner}/${repo}`, requested: args.from, fallback: def, sha: baseSha });
        resolvedFrom = def;
      }
    }

    if (!baseSha) {
      const requestedLabel = args.from || 'provided base';
      throw new Error(`No base SHA found for ${owner}/${repo}. Tried '${requestedLabel}' then default.`);
    }

    // 3) Create ref; treat 422 existing as idempotent success
    try {
      await githubRequest(`/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${branchName}`, sha: baseSha }, {}, 'POST');
    } catch (e) {
      const status = statusOf(e);
      const msg = String(e?.response?.data?.message || e?.message || '');
      if (status === 422 && /reference already exists/i.test(msg)) {
        const existing = await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${branchName}`);
        const sha = existing?.object?.sha;
        await auditLog('BRANCH_EXISTS', { repo: `${owner}/${repo}`, branch: branchName, sha });
        return { content: [{ type: 'text', text: JSON.stringify({
          success: true, exists: true, created: false, branch: branchName, sha,
          message: `Branch '${branchName}' already exists`,
          url: `https://github.com/${owner}/${repo}/tree/${branchName}`
        }) }] };
      }
      await auditLog('BRANCH_CREATE_FAILED', { repo: `${owner}/${repo}`, branch: branchName, error: e?.message });
      throw new Error(`Failed to create branch: ${e?.message}`);
    }

    await auditLog('BRANCH_CREATED', { repo: `${owner}/${repo}`, branch: branchName, from: resolvedFrom, sha: baseSha });
    return { content: [{ type: 'text', text: JSON.stringify({
      success: true, created: true, branch: branchName, from: resolvedFrom, sha: baseSha,
      message: `Successfully created branch '${branchName}'`,
      url: `https://github.com/${owner}/${repo}/tree/${branchName}`
    }) }] };
  };
}
/* END PATCH */

/* BEGIN PATCH: monkey-patch registration if original exists */
try {
  if (typeof toolRegistry !== 'undefined' && toolRegistry.get && toolRegistry.set) {
    const original = toolRegistry.get('create_branch');
    if (original) {
      toolRegistry.set('create_branch', __patched_handleCreateBranchFactory(githubRequest, assert, validateRepoFormat, validateBranch, isRepoWhitelisted, auditLog));
      console.log('✅ Patched create_branch handler with robust fallbacks and idempotency');
    }
  }
} catch (_e) { /* no-op if structure differs */ }
/* END PATCH */
