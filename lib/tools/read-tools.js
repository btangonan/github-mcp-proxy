/**
 * Read Tools Module
 *
 * Tool handlers for GitHub read operations:
 * - search: Search GitHub repositories
 * - fetch: Fetch repository metadata and README
 * - list_directory: List contents of a directory
 * - read_file: Read file contents
 * - get_tree: Get full repository tree structure
 * - get_commits: Get recent commits for a repository
 * - get_branches: List all branches in a repository
 *
 * @module lib/tools/read-tools
 */

/**
 * Search GitHub repositories
 * @param {Object} args - Search arguments
 * @param {string} args.query - Search query string
 * @returns {Promise<Object>} MCP response with search results
 */
async function handleSearch(args, { safeString, assert, githubRequest }) {
  const query = safeString(args.query, 200);
  assert(query.length > 0, 'Search query cannot be empty');

  const repoResponse = await githubRequest("/search/repositories", {
    q: query,
    per_page: 5,
    sort: "stars"
  });

  const results = repoResponse.items.map(repo => ({
    id: repo.full_name,
    title: `${repo.full_name} - ${repo.description || "No description"}`,
    url: repo.html_url
  }));

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ results })
      }
    ]
  };
}

/**
 * Fetch repository metadata and README
 * @param {Object} args - Fetch arguments
 * @param {string} args.repo - Repository in format owner/repo
 * @returns {Promise<Object>} MCP response with repository data
 */
async function handleFetch(args, { validateRepoFormat, githubRequest }) {
  const [owner, repo] = validateRepoFormat(args.repo);

  const repoResponse = await githubRequest(`/repos/${owner}/${repo}`);
  const readmeResponse = await githubRequest(`/repos/${owner}/${repo}/readme`, {}, {
    Accept: "application/vnd.github.raw"
  }).catch(() => "No README available");

  const document = {
    id: repoResponse.full_name,
    title: repoResponse.name,
    text: `# ${repoResponse.name}\n\n${repoResponse.description || ""}\n\n` +
          `Stars: ${repoResponse.stargazers_count}\n` +
          `Language: ${repoResponse.language || "Unknown"}\n` +
          `Created: ${repoResponse.created_at}\n\n` +
          `## README\n\n${readmeResponse}`,
    url: repoResponse.html_url,
    metadata: {
      stars: repoResponse.stargazers_count,
      language: repoResponse.language,
      owner: repoResponse.owner.login
    }
  };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(document)
      }
    ]
  };
}

/**
 * List contents of a directory in a repository
 * @param {Object} args - Directory listing arguments
 * @param {string} args.repo - Repository in format owner/repo
 * @param {string} [args.path] - Directory path
 * @param {string} [args.branch] - Branch name
 * @param {string} [args.ref] - Branch, tag, or commit SHA
 * @returns {Promise<Object>} MCP response with directory contents
 */
async function handleListDirectory(args, { validateRepoFormat, validatePath, validateBranch, githubRequest }) {
  const [owner, repo] = validateRepoFormat(args.repo);
  const path = validatePath(args.path);

  // Get actual default branch if not specified
  let branch = args.branch || args.ref;
  if (!branch) {
    const repoInfo = await githubRequest(`/repos/${owner}/${repo}`);
    branch = repoInfo.default_branch || 'main';
  }
  const validatedBranch = validateBranch(branch);

  try {
    const response = await githubRequest(`/repos/${owner}/${repo}/contents/${path}`, {
      ref: validatedBranch
    });

    const contents = Array.isArray(response) ? response : [response];
    const items = contents.map(item => ({
      name: item.name,
      type: item.type,
      path: item.path,
      size: item.size,
      url: item.html_url
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            path: path || "/",
            items: items
          })
        }
      ]
    };
  } catch (error) {
    // Try with master branch if main fails
    if (branch === "main") {
      const response = await githubRequest(`/repos/${owner}/${repo}/contents/${path}`, {
        ref: "master"
      });
      const contents = Array.isArray(response) ? response : [response];
      const items = contents.map(item => ({
        name: item.name,
        type: item.type,
        path: item.path,
        size: item.size,
        url: item.html_url
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              path: path || "/",
              items: items
            })
          }
        ]
      };
    }
    throw error;
  }
}

/**
 * Read contents of a specific file
 * @param {Object} args - File reading arguments
 * @param {string} args.repo - Repository in format owner/repo
 * @param {string} args.path - File path
 * @param {string} [args.branch] - Branch name
 * @param {string} [args.ref] - Branch, tag, or commit SHA
 * @returns {Promise<Object>} MCP response with file contents
 */
async function handleReadFile(args, { validateRepoFormat, validatePath, validateBranch, assert, githubRequest }) {
  const [owner, repo] = validateRepoFormat(args.repo);
  const path = validatePath(args.path);
  assert(path.length > 0, 'File path cannot be empty');

  // Get actual default branch if not specified
  let branch = args.branch || args.ref;
  if (!branch) {
    const repoInfo = await githubRequest(`/repos/${owner}/${repo}`);
    branch = repoInfo.default_branch || 'main';
  }
  const validatedBranch = validateBranch(branch);

  // Enhanced logging for debugging
  console.log(`📖 read_file called:
    repo: ${owner}/${repo}
    path: ${path}
    requested branch/ref: ${branch || 'none'}
    validated branch: ${validatedBranch}
    args: ${JSON.stringify(args)}`);

  try {
    const response = await githubRequest(`/repos/${owner}/${repo}/contents/${path}`, {
      ref: validatedBranch
    }, {
      Accept: "application/vnd.github.raw"
    });

    console.log(`✅ read_file successful for branch: ${validatedBranch}`);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            path: path,
            content: response,
            url: `https://github.com/${owner}/${repo}/blob/${validatedBranch}/${path}`,
            branch: validatedBranch
          })
        }
      ]
    };
  } catch (error) {
    console.log(`❌ read_file failed for branch ${validatedBranch}: ${error.message}`);

    // Only try master fallback if we explicitly requested main and it failed
    // This prevents silent fallback when a specific branch is requested
    if (validatedBranch === "main" && error.statusCode === 404) {
      console.log(`🔄 Trying master branch fallback...`);
      try {
        const response = await githubRequest(`/repos/${owner}/${repo}/contents/${path}`, {
          ref: "master"
        }, {
          Accept: "application/vnd.github.raw"
        });

        console.log(`✅ read_file successful with master fallback`);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                path: path,
                content: response,
                url: `https://github.com/${owner}/${repo}/blob/master/${path}`,
                branch: "master"
              })
            }
          ]
        };
      } catch (masterError) {
        console.log(`❌ Master fallback also failed: ${masterError.message}`);
        throw masterError;
      }
    }

    // For any other branch or error, throw the original error
    throw error;
  }
}

/**
 * Get the full repository tree structure
 * @param {Object} args - Tree arguments
 * @param {string} args.repo - Repository in format owner/repo
 * @param {string} [args.branch] - Branch name
 * @param {string} [args.ref] - Branch, tag, or commit SHA
 * @returns {Promise<Object>} MCP response with repository tree
 */
async function handleGetTree(args, { validateRepoFormat, validateBranch, githubRequest }) {
  const [owner, repo] = validateRepoFormat(args.repo);

  // Get actual default branch if not specified
  let branch = args.branch || args.ref;
  if (!branch) {
    const repoInfo = await githubRequest(`/repos/${owner}/${repo}`);
    branch = repoInfo.default_branch || 'main';
  }
  const validatedBranch = validateBranch(branch);

  try {
    // Get the branch to find the tree SHA
    const branchResponse = await githubRequest(`/repos/${owner}/${repo}/branches/${validatedBranch}`);
    const treeSha = branchResponse.commit.commit.tree.sha;

    // Get the tree recursively
    const treeResponse = await githubRequest(`/repos/${owner}/${repo}/git/trees/${treeSha}`, {
      recursive: 1
    });

    const tree = treeResponse.tree.map(item => ({
      path: item.path,
      type: item.type,
      size: item.size
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            branch: branch,
            tree: tree
          })
        }
      ]
    };
  } catch (error) {
    // Try with master branch if main fails
    if (branch === "main") {
      const branchResponse = await githubRequest(`/repos/${owner}/${repo}/branches/master`);
      const treeSha = branchResponse.commit.commit.tree.sha;
      const treeResponse = await githubRequest(`/repos/${owner}/${repo}/git/trees/${treeSha}`, {
        recursive: 1
      });

      const tree = treeResponse.tree.map(item => ({
        path: item.path,
        type: item.type,
        size: item.size
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              branch: "master",
              tree: tree
            })
          }
        ]
      };
    }
    throw error;
  }
}

/**
 * Get recent commits for a repository
 * @param {Object} args - Commits arguments
 * @param {string} args.repo - Repository in format owner/repo
 * @param {string} [args.path] - Optional path to filter commits
 * @param {string} [args.branch] - Branch name
 * @param {string} [args.ref] - Branch, tag, or commit SHA
 * @param {number} [args.limit=10] - Number of commits to return (1-100)
 * @returns {Promise<Object>} MCP response with commits
 */
async function handleGetCommits(args, { validateRepoFormat, validatePath, githubRequest }) {
  const [owner, repo] = validateRepoFormat(args.repo);
  const path = args.path ? validatePath(args.path) : undefined;
  const branch = args.branch || args.ref; // Support both branch and ref parameters
  const limit = Math.min(Math.max(parseInt(args.limit) || 10, 1), 100);

  const params = { per_page: limit };
  if (path) params.path = path;
  if (branch) params.sha = branch; // Critical fix: use sha parameter for branch

  const response = await githubRequest(`/repos/${owner}/${repo}/commits`, params);

  const commits = response.map(commit => ({
    sha: commit.sha.substring(0, 7),
    message: commit.commit.message.split('\n')[0],
    author: commit.commit.author.name,
    date: commit.commit.author.date,
    url: commit.html_url
  }));

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          commits: commits
        })
      }
    ]
  };
}

/**
 * List all branches in a repository
 * @param {Object} args - Branches arguments
 * @param {string} args.repo - Repository in format owner/repo
 * @returns {Promise<Object>} MCP response with branches
 */
async function handleGetBranches(args, { validateRepoFormat, githubRequest }) {
  const [owner, repo] = validateRepoFormat(args.repo);

  const [branchesResp, repoInfo] = await Promise.all([
    githubRequest(`/repos/${owner}/${repo}/branches`, { per_page: 100 }),
    githubRequest(`/repos/${owner}/${repo}`)
  ]);

  const branches = branchesResp.map(branch => ({
    name: branch.name,
    protected: branch.protected
  }));

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          branches,
          default: repoInfo.default_branch
        })
      }
    ]
  };
}

module.exports = {
  handleSearch,
  handleFetch,
  handleListDirectory,
  handleReadFile,
  handleGetTree,
  handleGetCommits,
  handleGetBranches
};
