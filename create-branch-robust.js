const { URL } = require('url');

module.exports.handleCreateBranchRobust = async function handleCreateBranchRobust(args) {
  const { githubRequest, validateRepoFormat, validateBranch, assert, isRepoWhitelisted, auditLog } = require('./create-branch-shared');
  const [owner, repo] = validateRepoFormat(args.repo);
  const branchName = validateBranch(args.branch);
  assert(branchName, 'Branch name is required');
  assert(isRepoWhitelisted(owner, repo), `Repository ${owner}/${repo} is not whitelisted for branch creation`);

  // 1) idempotency: branch already exists
  try {
    const existing = await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${branchName}`);
    if (existing?.object?.sha) {
      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: true, exists: true, branch: branchName, sha: existing.object.sha,
          message: `Branch '${branchName}' already exists`,
          url: `https://github.com/${owner}/${repo}/tree/${branchName}`
        }) }]
      };
    }
  } catch (e) {
    const code = e.statusCode || e.response?.status;
    if (code && code !== 404) throw e;
  }

  // 2) resolve base SHA with fallbacks
  const requestedBase = (args.from || '').trim();
  let baseSha = null;

  async function getShaFromHeads(b) {
    const r = await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${b}`);
    return r?.object?.sha;
  }
  async function getShaFromBranches(b) {
    const r = await githubRequest(`/repos/${owner}/${repo}/branches/${b}`);
    return r?.commit?.sha;
  }

  if (requestedBase) {
    try { baseSha = await getShaFromHeads(requestedBase); } catch (e) {
      const code = e.statusCode || e.response?.status;
      if (code !== 404) throw e;
    }
  }

  if (!baseSha) {
    const repoInfo = await githubRequest(`/repos/${owner}/${repo}`);
    const def = repoInfo?.default_branch || 'main';
    try { baseSha = await getShaFromHeads(def); } catch (e) {
      const code = e.statusCode || e.response?.status;
      if (code === 404) baseSha = await getShaFromBranches(def); else throw e;
    }
  }

  if (!baseSha) {
    throw new Error(`No base SHA found for ${owner}/${repo}. Tried '${requestedBase || 'provided base'}' then default.`);
  }

  // 3) create ref (idempotent on 422 already exists)
  try {
    await githubRequest(`/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${branchName}`, sha: baseSha }, {}, 'POST');
  } catch (e) {
    const code = e.statusCode || e.response?.status;
    const msg = String(e.message || '');
    if (code === 422 && /reference already exists/i.test(msg)) {
      // treat as success
    } else {
      await auditLog?.('BRANCH_CREATE_FAILED', { repo: `${owner}/${repo}`, branch: branchName, error: e.message });
      throw new Error(`Failed to create branch: ${e.message}`);
    }
  }

  await auditLog?.('BRANCH_CREATED', { repo: `${owner}/${repo}`, branch: branchName, from: requestedBase || 'default', sha: baseSha });
  return { content: [{ type: 'text', text: JSON.stringify({
    success: true, branch: branchName, from: requestedBase || 'default', sha: baseSha,
    message: `Successfully created branch '${branchName}'`,
    url: `https://github.com/${owner}/${repo}/tree/${branchName}`
  }) }] };
};
