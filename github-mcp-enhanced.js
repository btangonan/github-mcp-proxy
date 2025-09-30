require("dotenv").config();

const express = require("express");
const axios = require("axios");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();

// Configuration from environment variables
const config = {
  // Server configuration
  port: parseInt(process.env.PORT) || 8788,
  host: process.env.HOST || 'localhost',

  // GitHub API configuration
  githubToken: process.env.GITHUB_PAT,
  githubApiTimeout: parseInt(process.env.GITHUB_API_TIMEOUT) || 30000,
  githubRetryAttempts: parseInt(process.env.GITHUB_RETRY_ATTEMPTS) || 3,

  // Rate limiting configuration
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 1000,

  // Cache configuration
  cacheTTL: parseInt(process.env.CACHE_TTL) || 5 * 60 * 1000, // 5 minutes
  cacheMaxSize: parseInt(process.env.CACHE_MAX_SIZE) || 1000,

  // Security configuration
  bodySizeLimit: process.env.BODY_SIZE_LIMIT || '10mb',
  enableTrustProxy: process.env.TRUST_PROXY === 'true',

  // Logging configuration
  logLevel: process.env.LOG_LEVEL || 'info',
  enableAccessLog: process.env.ENABLE_ACCESS_LOG === 'true',

  // CORS configuration
  allowedOrigins: process.env.ALLOWED_ORIGINS ?
    process.env.ALLOWED_ORIGINS.split(',') :
    ['https://chatgpt.com', 'https://chat.openai.com', 'https://platform.openai.com'],

  // PR creation configuration
  prEnabled: process.env.PR_ENABLED === 'true',
  prWhitelist: process.env.PR_WHITELIST ? process.env.PR_WHITELIST.split(',') : [],
  prRateLimitMax: parseInt(process.env.PR_RATE_LIMIT_MAX) || 5,
  prRateLimitWindow: parseInt(process.env.PR_RATE_LIMIT_WINDOW) || 60 * 60 * 1000, // 1 hour
  prAuditLog: process.env.PR_AUDIT_LOG || './pr_audit.log',
  prTemplateRequired: process.env.PR_TEMPLATE_REQUIRED === 'true'
};

// Validate required configuration
if (!config.githubToken) {
  console.error("❌ Please set GITHUB_PAT environment variable.");
  process.exit(1);
}

console.log("📋 Server Configuration:");
console.log(`   • Port: ${config.port}`);
console.log(`   • Cache TTL: ${config.cacheTTL / 1000}s`);
console.log(`   • Rate Limit: ${config.rateLimitMax} requests per ${config.rateLimitWindow / 60000} minutes`);
console.log(`   • GitHub API Timeout: ${config.githubApiTimeout / 1000}s`);
if (config.prEnabled) {
  console.log(`   • PR Creation: ENABLED`);
  console.log(`   • PR Whitelist: ${config.prWhitelist.length > 0 ? config.prWhitelist.join(', ') : 'None (disabled)'}`);
  console.log(`   • PR Rate Limit: ${config.prRateLimitMax} per ${config.prRateLimitWindow / 60000} minutes`);
}
console.log("");

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow ChatGPT to embed content
  crossOriginEmbedderPolicy: false
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimitWindow,
  max: config.rateLimitMax,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  }
});
app.use(limiter);

// Enhanced CORS for ChatGPT
app.use((req, res, next) => {
  const allowedOrigins = config.allowedOrigins;

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin) || !origin) {
    res.header("Access-Control-Allow-Origin", origin || "*");
  }

  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.header("Access-Control-Max-Age", "86400"); // 24 hours

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Parse JSON bodies with configurable size limit
app.use(express.json({ limit: config.bodySizeLimit }));

// Simple in-memory cache with configurable TTL
const cache = new Map();

// PR rate limiting tracker
const prRateLimiter = new Map();

// Audit logging for PR operations
const fs = require('fs').promises;
const path = require('path');

async function auditLog(action, data) {
  if (!config.prAuditLog) return;

  const logEntry = {
    timestamp: new Date().toISOString(),
    action,
    ...data
  };

  try {
    await fs.appendFile(
      config.prAuditLog,
      JSON.stringify(logEntry) + '\n',
      'utf8'
    );
  } catch (error) {
    console.error('Failed to write audit log:', error.message);
  }
}

// Cache cleanup to prevent memory leaks
setInterval(() => {
  if (cache.size > config.cacheMaxSize) {
    // Remove oldest entries if cache is too large
    const entries = Array.from(cache.entries());
    const toDelete = entries.slice(0, Math.floor(cache.size * 0.2)); // Remove 20%
    toDelete.forEach(([key]) => cache.delete(key));
    console.log(`🧹 Cache cleanup: removed ${toDelete.length} entries`);
  }
}, 60000); // Check every minute

// Enhanced GitHub API client with configurable timeouts and retries
const github = axios.create({
  baseURL: "https://api.github.com",
  timeout: config.githubApiTimeout,
  headers: {
    Authorization: `Bearer ${config.githubToken}`,
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "GitHub-MCP-Server/2.0"
  }
});

// Retry interceptor
github.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;

    // Don't retry if we've already retried the configured number of times
    if (!config || config._retryCount >= config.githubRetryAttempts) {
      return Promise.reject(error);
    }

    config._retryCount = config._retryCount || 0;
    config._retryCount++;

    // Retry on network errors or 5xx status codes
    if (!error.response || (error.response.status >= 500 && error.response.status <= 599)) {
      console.log(`🔄 Retrying GitHub API request (attempt ${config._retryCount})`);

      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, config._retryCount - 1) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));

      return github(config);
    }

    return Promise.reject(error);
  }
);

// Cache helper functions
function getCacheKey(url, params = {}) {
  return `${url}:${JSON.stringify(params)}`;
}

function getCachedData(key) {
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiry) {
    return cached.data;
  }
  cache.delete(key);
  return null;
}

function setCachedData(key, data) {
  cache.set(key, {
    data,
    expiry: Date.now() + config.cacheTTL
  });
}

// Input validation functions
function assert(condition, message = "Assertion failed") {
  if (!condition) {
    throw new Error(message);
  }
}

function safeString(str, maxLength = 1000) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').substring(0, maxLength);
}

function validateRepoFormat(repoId) {
  assert(repoId && typeof repoId === 'string', 'Repository ID must be a string');
  const parts = repoId.split('/');
  assert(parts.length === 2, 'Repository ID must be in format "owner/repo"');
  assert(parts[0] && parts[1], 'Both owner and repo name must be provided');
  assert(/^[a-zA-Z0-9._-]+$/.test(parts[0]), 'Invalid owner name format');
  assert(/^[a-zA-Z0-9._-]+$/.test(parts[1]), 'Invalid repo name format');
  return parts;
}

function validatePath(path) {
  if (!path) return '';
  const safePath = safeString(path, 500);
  assert(!safePath.includes('..'), 'Path traversal not allowed');
  assert(!safePath.startsWith('/'), 'Absolute paths not allowed');
  return safePath;
}

function validateBranch(branch) {
  // Don't default to 'main' - require explicit branch name
  assert(branch, 'Branch name is required');
  const safeBranch = safeString(branch, 100);
  assert(/^[a-zA-Z0-9._/-]+$/.test(safeBranch), 'Invalid branch name format');
  return safeBranch;
}

// Repository whitelist validation
function isRepoWhitelisted(owner, repo) {
  if (!config.prEnabled) return false;
  if (config.prWhitelist.length === 0) return false;

  const fullRepo = `${owner}/${repo}`;

  // Check exact match or pattern match
  return config.prWhitelist.some(pattern => {
    if (pattern === fullRepo) return true;
    if (pattern.endsWith('/*')) {
      const ownerPattern = pattern.slice(0, -2);
      return owner === ownerPattern;
    }
    return false;
  });
}

// PR rate limiting check
function checkPRRateLimit(identifier) {
  const now = Date.now();
  const key = `pr_${identifier}`;

  // Clean old entries
  for (const [k, v] of prRateLimiter.entries()) {
    if (now - v.timestamp > config.prRateLimitWindow) {
      prRateLimiter.delete(k);
    }
  }

  const entry = prRateLimiter.get(key);
  if (!entry) {
    prRateLimiter.set(key, { count: 1, timestamp: now });
    return true;
  }

  if (now - entry.timestamp > config.prRateLimitWindow) {
    prRateLimiter.set(key, { count: 1, timestamp: now });
    return true;
  }

  if (entry.count >= config.prRateLimitMax) {
    return false;
  }

  entry.count++;
  return true;
}

// Tool Registry Pattern
const toolRegistry = new Map();

// Tool handler functions
async function handleSearch(args) {
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

async function handleFetch(args) {
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

async function handleListDirectory(args) {
  const [owner, repo] = validateRepoFormat(args.repo);
  const path = validatePath(args.path);
  const branch = validateBranch(args.branch);

  try {
    const response = await githubRequest(`/repos/${owner}/${repo}/contents/${path}`, {
      ref: branch
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

async function handleReadFile(args) {
  const [owner, repo] = validateRepoFormat(args.repo);
  const path = validatePath(args.path);
  assert(path.length > 0, 'File path cannot be empty');
  const branch = args.branch || args.ref; // Support both branch and ref parameters
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

async function handleGetTree(args) {
  const [owner, repo] = validateRepoFormat(args.repo);
  const branch = validateBranch(args.branch);

  try {
    // Get the branch to find the tree SHA
    const branchResponse = await githubRequest(`/repos/${owner}/${repo}/branches/${branch}`);
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

async function handleGetCommits(args) {
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

async function handleCreatePullRequest(args) {
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

  // Validate required fields
  const title = safeString(args.title, 200);
  assert(title && title.length > 0, 'PR title is required');

  const body = safeString(args.body || '', 5000);
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
    // Check if base branch exists
    try {
      await githubRequest(`/repos/${owner}/${repo}/branches/${base}`);
    } catch (baseError) {
      throw new Error(`Base branch '${base}' not found in ${owner}/${repo}`);
    }

    // Check if head branch exists, create if needed and allowed
    let headExists = false;
    let branchCreated = false;

    try {
      await githubRequest(`/repos/${owner}/${repo}/branches/${head}`);
      headExists = true;
    } catch (headError) {
      if (headError.message.includes('404') && args.create_branch_if_missing === true) {
        // Create the branch from base
        console.log(`🔄 Head branch '${head}' not found, creating from '${base}'...`);

        try {
          const branchResult = await handleCreateBranch({
            repo: args.repo,
            branch: head,
            from: base
          });

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

      try {
        const commitResult = await handleCommitFiles({
          repo: args.repo,
          branch: head,
          files: args.files,
          message: args.commit_message || `Add files for PR: ${title}`
        });

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

async function handleListPullRequests(args) {
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

async function handleSearchPullRequests(args) {
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

async function handleGetPullRequest(args) {
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

async function handleGetBranches(args) {
  const [owner, repo] = validateRepoFormat(args.repo);

  const response = await githubRequest(`/repos/${owner}/${repo}/branches`, {
    per_page: 100
  });

  const branches = response.map(branch => ({
    name: branch.name,
    protected: branch.protected
  }));

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          branches: branches,
          default: branches.find(b => b.name === "main" || b.name === "master")?.name || branches[0]?.name
        })
      }
    ]
  };
}

async function handleCreateBranch(args) {
  const [owner, repo] = validateRepoFormat(args.repo);
  const branchName = validateBranch(args.branch);
  assert(branchName, 'Branch name is required');

  // Check whitelist for branch creation (same security as PR creation)
  if (config.prWhitelist.length > 0) {
    const repoPath = `${owner}/${repo}`;
    const isWhitelisted = config.prWhitelist.some(pattern => {
      const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
      return regex.test(repoPath);
    });

    if (!isWhitelisted) {
      throw new Error(`Repository ${repoPath} is not whitelisted for branch creation`);
    }
  }

  try {
    // First check if branch already exists (idempotent)
    try {
      const existingBranch = await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${branchName}`);
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

    // Get the SHA of the base branch
    let baseSha;
    try {
      const baseBranchData = await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${baseBranch}`);
      baseSha = baseBranchData.object.sha;
    } catch (error) {
      if (error.statusCode === 404) {
        // Try to get default branch from repo info
        const repoInfo = await githubRequest(`/repos/${owner}/${repo}`);
        const defaultBranch = repoInfo.default_branch;
        if (baseBranch === 'main' || baseBranch === defaultBranch) {
          const defaultBranchData = await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${defaultBranch}`);
          baseSha = defaultBranchData.object.sha;
        } else {
          throw new Error(`Base branch '${baseBranch}' not found`);
        }
      } else {
        throw error;
      }
    }

    // Create the new branch
    const response = await githubRequest(`/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseSha
      })
    });

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

// Handle committing files to a branch
async function handleCommitFiles(args) {
  const [owner, repo] = validateRepoFormat(args.repo);
  const branchName = validateBranch(args.branch);
  assert(branchName, 'Branch name is required');
  assert(args.message, 'Commit message is required');
  assert(Array.isArray(args.files) && args.files.length > 0, 'Files array is required');

  // Check whitelist
  if (config.prWhitelist.length > 0) {
    const repoPath = `${owner}/${repo}`;
    const isWhitelisted = config.prWhitelist.some(pattern => {
      const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
      return regex.test(repoPath);
    });

    if (!isWhitelisted) {
      throw new Error(`Repository ${repoPath} is not whitelisted for file commits`);
    }
  }

  try {
    // Get the current branch SHA
    const branchRef = await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${branchName}`);
    const currentSha = branchRef.object.sha;

    // Get the current tree
    const currentCommit = await githubRequest(`/repos/${owner}/${repo}/git/commits/${currentSha}`);
    const baseTreeSha = currentCommit.tree.sha;

    // Create blobs for each file
    const blobs = await Promise.all(args.files.map(async file => {
      const content = file.encoding === 'base64' ? file.content : Buffer.from(file.content).toString('base64');
      const blob = await githubRequest(`/repos/${owner}/${repo}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({
          content: content,
          encoding: 'base64'
        })
      });
      return {
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha
      };
    }));

    // Create a new tree with the files
    const newTree = await githubRequest(`/repos/${owner}/${repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: blobs
      })
    });

    // Create the commit
    const newCommit = await githubRequest(`/repos/${owner}/${repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: args.message,
        tree: newTree.sha,
        parents: [currentSha]
      })
    });

    // Update the branch reference
    await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${branchName}`, {
      method: 'PATCH',
      body: JSON.stringify({
        sha: newCommit.sha
      })
    });

    await auditLog('FILES_COMMITTED', {
      repo: `${owner}/${repo}`,
      branch: branchName,
      fileCount: args.files.length,
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
            files: args.files.map(f => f.path),
            message: `Successfully committed ${args.files.length} file(s) to '${branchName}'`,
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
    throw new Error(`Failed to commit files: ${error.message}`);
  }
}

// Register all tools
toolRegistry.set("search", handleSearch);
toolRegistry.set("fetch", handleFetch);
toolRegistry.set("list_directory", handleListDirectory);
toolRegistry.set("read_file", handleReadFile);
toolRegistry.set("get_tree", handleGetTree);
toolRegistry.set("get_commits", handleGetCommits);
toolRegistry.set("get_branches", handleGetBranches);

// Register PR/branch tools only if enabled
if (config.prEnabled && config.prWhitelist.length > 0) {
  toolRegistry.set("create_pull_request", handleCreatePullRequest);
  toolRegistry.set("create_branch", handleCreateBranch);
  toolRegistry.set("commit_files", handleCommitFiles);
}

// Register PR search/list tools (always available for reading)
toolRegistry.set("list_pull_requests", handleListPullRequests);
toolRegistry.set("search_pull_requests", handleSearchPullRequests);
toolRegistry.set("get_pull_request", handleGetPullRequest);

// Enhanced GitHub API wrapper with caching
async function githubRequest(endpoint, params = {}, headers = {}, method = 'GET') {
  const cacheKey = getCacheKey(endpoint, { params, headers, method });

  // Disable caching to ensure fresh data
  // ChatGPT needs real-time data, not cached responses
  // if (method === 'GET') {
  //   const cached = getCachedData(cacheKey);
  //   if (cached) {
  //     console.log(`📦 Cache hit for ${endpoint}`);
  //     return cached;
  //   }
  // }

  try {
    console.log(`🌐 ${method} ${endpoint}`);
    const config = {};

    if (method === 'GET') {
      config.params = params;
    } else if (method === 'POST') {
      config.data = params;
    }

    if (Object.keys(headers).length > 0) {
      config.headers = headers;
    }

    config.method = method;

    const response = await github.request({
      ...config,
      url: endpoint
    });

    // Disable caching to ensure fresh data
    // if (method === 'GET') {
    //   setCachedData(cacheKey, response.data);
    // }

    return response.data;
  } catch (error) {
    console.error(`❌ GitHub API error for ${method} ${endpoint}:`, error.response?.status, error.message);
    throw error;
  }
}

// MCP endpoint
app.post("/mcp", async (req, res) => {
  console.log("📨 MCP Request:", JSON.stringify(req.body, null, 2));

  try {
    const { jsonrpc, method, params, id } = req.body;

    // Handle initialize method
    if (method === "initialize") {
      return res.status(200).json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: {
            tools: {},
            resources: {}
          },
          serverInfo: {
            name: "github-mcp-enhanced",
            version: "2.0.0"
          }
        }
      });
    }

    // Handle initialized notification
    if (method === "notifications/initialized") {
      return res.status(200).json({
        jsonrpc: "2.0",
        result: "ok"
      });
    }

    // List all available tools
    if (method === "tools/list") {
      const result = {
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "search",
              description: "Search GitHub repositories",
              inputSchema: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "Search query for GitHub"
                  }
                },
                required: ["query"]
              }
            },
            {
              name: "fetch",
              description: "Fetch repository metadata and README",
              inputSchema: {
                type: "object",
                properties: {
                  repo: {
                    type: "string",
                    description: "Repository name (owner/repo)"
                  }
                },
                required: ["repo"]
              }
            },
            {
              name: "list_directory",
              description: "List contents of a directory in a repository",
              inputSchema: {
                type: "object",
                properties: {
                  repo: {
                    type: "string",
                    description: "Repository (owner/repo)"
                  },
                  path: {
                    type: "string",
                    description: "Directory path (e.g., 'src/components')"
                  },
                  branch: {
                    type: "string",
                    description: "Branch name (default: main/master)"
                  }
                },
                required: ["repo"]
              }
            },
            {
              name: "read_file",
              description: "Read contents of a specific file",
              inputSchema: {
                type: "object",
                properties: {
                  repo: {
                    type: "string",
                    description: "Repository (owner/repo)"
                  },
                  path: {
                    type: "string",
                    description: "File path (e.g., 'src/index.js')"
                  },
                  branch: {
                    type: "string",
                    description: "Branch name (default: main/master)"
                  }
                },
                required: ["repo", "path"]
              }
            },
            {
              name: "get_tree",
              description: "Get the full repository tree structure",
              inputSchema: {
                type: "object",
                properties: {
                  repo: {
                    type: "string",
                    description: "Repository (owner/repo)"
                  },
                  branch: {
                    type: "string",
                    description: "Branch name (default: main/master)"
                  }
                },
                required: ["repo"]
              }
            },
            {
              name: "get_commits",
              description: "Get recent commits for a repository",
              inputSchema: {
                type: "object",
                properties: {
                  repo: {
                    type: "string",
                    description: "Repository (owner/repo)"
                  },
                  path: {
                    type: "string",
                    description: "Optional path to filter commits"
                  },
                  limit: {
                    type: "number",
                    description: "Number of commits to return (default: 10)"
                  }
                },
                required: ["repo"]
              }
            },
            {
              name: "get_branches",
              description: "List all branches in a repository",
              inputSchema: {
                type: "object",
                properties: {
                  repo: {
                    type: "string",
                    description: "Repository (owner/repo)"
                  }
                },
                required: ["repo"]
              }
            },
            {
              name: "list_pull_requests",
              description: "List pull requests in a repository",
              inputSchema: {
                type: "object",
                properties: {
                  repo: {
                    type: "string",
                    description: "Repository (owner/repo)"
                  },
                  state: {
                    type: "string",
                    description: "Filter by state: open, closed, all (default: open)"
                  },
                  base: {
                    type: "string",
                    description: "Filter by base branch"
                  },
                  head: {
                    type: "string",
                    description: "Filter by head branch"
                  },
                  limit: {
                    type: "number",
                    description: "Max results (default 30)"
                  },
                  page: {
                    type: "number",
                    description: "Page number (default 1)"
                  }
                },
                required: ["repo"]
              }
            },
            {
              name: "search_pull_requests",
              description: "Search for pull requests using GitHub's search API",
              inputSchema: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "Search query (automatically prepends is:pr)"
                  },
                  repo: {
                    type: "string",
                    description: "Optional: limit to specific repo (owner/name format)"
                  },
                  limit: {
                    type: "number",
                    description: "Max results (default 30)"
                  }
                },
                required: ["query"]
              }
            },
            {
              name: "get_pull_request",
              description: "Get detailed information about a specific pull request",
              inputSchema: {
                type: "object",
                properties: {
                  repo: {
                    type: "string",
                    description: "Repository (owner/repo)"
                  },
                  prNumber: {
                    type: "number",
                    description: "Pull request number"
                  },
                  includeCommits: {
                    type: "boolean",
                    description: "Include commit list (default false)"
                  },
                  includeFiles: {
                    type: "boolean",
                    description: "Include changed files (default false)"
                  },
                  includeReviews: {
                    type: "boolean",
                    description: "Include reviews (default false)"
                  }
                },
                required: ["repo", "prNumber"]
              }
            }
          ]
        }
      };

      // Add PR-related tools if enabled
      if (config.prEnabled) {
        const prTools = [
          {
            name: "create_pull_request",
            description: "Create a pull request in a repository. Automatically checks for existing PRs to prevent duplicates. Can optionally create the head branch if missing and commit files before creating the PR",
            inputSchema: {
              type: "object",
              properties: {
                repo: {
                  type: "string",
                  description: "Repository in format owner/repo (e.g., 'octocat/hello-world')"
                },
                title: {
                  type: "string",
                  description: "Title of the pull request"
                },
                body: {
                  type: "string",
                  description: "Description/body of the pull request"
                },
                head: {
                  type: "string",
                  description: "The branch containing your changes (e.g., 'feature-branch')"
                },
                base: {
                  type: "string",
                  description: "The branch you want to merge into (default: repository's default branch)"
                },
                draft: {
                  type: "boolean",
                  description: "Create as draft PR (default: false)"
                },
                create_branch_if_missing: {
                  type: "boolean",
                  description: "Create the head branch if it doesn't exist (default: false)"
                },
                files: {
                  type: "array",
                  description: "Optional files to commit to the branch before creating PR",
                  items: {
                    type: "object",
                    properties: {
                      path: {
                        type: "string",
                        description: "File path relative to repo root"
                      },
                      content: {
                        type: "string",
                        description: "File content"
                      },
                      encoding: {
                        type: "string",
                        enum: ["utf8", "base64"],
                        description: "Content encoding (default: utf8)"
                      }
                    },
                    required: ["path", "content"]
                  }
                },
                commit_message: {
                  type: "string",
                  description: "Commit message if files are provided (default: 'Add files for PR: [title]')"
                }
              },
              required: ["repo", "title", "head"]
            }
          },
          {
            name: "create_branch",
            description: "Create a new branch in a repository from an existing branch or commit. Returns success if branch already exists (idempotent)",
            inputSchema: {
              type: "object",
              properties: {
                repo: {
                  type: "string",
                  description: "Repository in format owner/repo (e.g., 'octocat/hello-world')"
                },
                branch: {
                  type: "string",
                  description: "Name for the new branch (e.g., 'feat/new-feature')"
                },
                from: {
                  type: "string",
                  description: "Source branch or commit SHA to branch from (defaults to repository's default branch)"
                }
              },
              required: ["repo", "branch"]
            }
          },
          {
            name: "commit_files",
            description: "Commit files to a branch in a repository",
            inputSchema: {
              type: "object",
              properties: {
                repo: {
                  type: "string",
                  description: "Repository in format owner/repo (e.g., 'octocat/hello-world')"
                },
                branch: {
                  type: "string",
                  description: "Branch to commit to"
                },
                message: {
                  type: "string",
                  description: "Commit message"
                },
                files: {
                  type: "array",
                  description: "Array of files to commit",
                  items: {
                    type: "object",
                    properties: {
                      path: {
                        type: "string",
                        description: "File path in repository"
                      },
                      content: {
                        type: "string",
                        description: "File content (base64 encoded if binary)"
                      },
                      encoding: {
                        type: "string",
                        description: "Content encoding: 'utf8' (default) or 'base64'",
                        enum: ["utf8", "base64"]
                      }
                    },
                    required: ["path", "content"]
                  }
                }
              },
              required: ["repo", "branch", "message", "files"]
            }
          }
        ];

        result.result.tools.push(...prTools);
      }

      return res.json(result);
    }

    // Handle tool calls
    if (method === "tools/call") {
      try {
        const { name, arguments: args } = params;

        // Use tool registry for cleaner code organization
        const toolHandler = toolRegistry.get(name);

        if (!toolHandler) {
          return res.status(404).json({
            jsonrpc: "2.0",
            id,
            error: {
              code: -32601,
              message: `Unknown tool: ${name}`
            }
          });
        }

        // Execute tool handler and return result
        const result = await toolHandler(args);

        return res.status(200).json({
          jsonrpc: "2.0",
          id,
          result
        });

      } catch (error) {
        console.error("❌ Tool execution error:", error.message);
        return res.status(400).json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32602,
            message: `Invalid params: ${error.message}`
          }
        });
      }
    }

    // Unknown method
    return res.status(501).json({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`
      }
    });

  } catch (error) {
    console.error("❌ Error:", error.message);
    return res.status(500).json({
      jsonrpc: "2.0",
      id: req.body?.id || null,
      error: {
        code: -32603,
        message: `Internal error: ${error.message}`
      }
    });
  }
});

// Enhanced health check
app.get("/health", (req, res) => {
  try {
    const healthData = {
      status: "healthy",
      service: "GitHub MCP Enhanced v2.0",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: "2.0.0",
      capabilities: {
        tools: Array.from(toolRegistry.keys()),
        cache_enabled: cache.size >= 0,
        github_token: !!config.githubToken
      }
    };

    res.status(200).json(healthData);
  } catch (error) {
    res.status(503).json({
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Version endpoint with commit info
app.get("/version", (req, res) => {
  const startTime = process.hrtime.bigint();
  try {
    const versionData = {
      name: "github-mcp-enhanced",
      version: "2.0.0",
      commit_sha: process.env.GIT_SHA || "dev",
      build_time: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      node_version: process.version,
      platform: process.platform,
      tools_count: toolRegistry.size,
      pr_enabled: config.prEnabled
    };
    const endTime = process.hrtime.bigint();
    versionData.response_time_ns = Number(endTime - startTime);
    res.status(200).json(versionData);
  } catch (error) {
    res.status(500).json({
      error: "Version info unavailable",
      message: error.message
    });
  }
});

// SSE endpoint for ChatGPT
app.get("/sse", (req, res) => {
  try {
    // Set proper SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
      "X-Accel-Buffering": "no" // Disable nginx buffering
    });

    // Send initial connection event
    res.write('event: open\n');
    res.write('data: {"type":"connection_established","timestamp":"' + new Date().toISOString() + '"}\n\n');

    // Keep connection alive with periodic pings
    const interval = setInterval(() => {
      if (!res.writableEnded) {
        res.write("event: ping\n");
        res.write('data: {"timestamp":"' + new Date().toISOString() + '"}\n\n');
      } else {
        clearInterval(interval);
      }
    }, 30000);

    // Clean up on client disconnect
    req.on("close", () => {
      clearInterval(interval);
      console.log("🔌 SSE client disconnected");
    });

    req.on("error", (error) => {
      console.error("❌ SSE connection error:", error.message);
      clearInterval(interval);
    });

  } catch (error) {
    console.error("❌ SSE setup error:", error.message);
    if (!res.headersSent) {
      res.status(500).json({
        error: "SSE connection failed",
        message: error.message
      });
    }
  }
});

// SSE endpoint for MCP messages - streamlined handler
app.post("/sse", async (req, res) => {
  console.log("📨 SSE MCP Request:", JSON.stringify(req.body, null, 2));

  try {
    // Validate JSON-RPC request structure
    if (!req.body || !req.body.jsonrpc || !req.body.method) {
      return res.status(400).json({
        jsonrpc: "2.0",
        id: req.body?.id || null,
        error: {
          code: -32600,
          message: "Invalid JSON-RPC request"
        }
      });
    }

    const { jsonrpc, method, params, id } = req.body;

    // Handle initialize method
    if (method === "initialize") {
      return res.status(200).json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: {
            tools: {},
            resources: {}
          },
          serverInfo: {
            name: "github-mcp-enhanced",
            version: "2.0.0"
          }
        }
      });
    }

    // Handle initialized notification
    if (method === "notifications/initialized") {
      return res.status(200).json({
        jsonrpc: "2.0",
        result: "ok"
      });
    }

    // List all available tools
    if (method === "tools/list") {
      return res.status(200).json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: Array.from(toolRegistry.keys()).map(name => ({
            name,
            description: `GitHub tool: ${name}`,
            inputSchema: { type: "object" }
          }))
        }
      });
    }

    // Handle tool calls using registry
    if (method === "tools/call") {
      const { name, arguments: args } = params;
      const toolHandler = toolRegistry.get(name);

      if (!toolHandler) {
        return res.status(404).json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Unknown tool: ${name}`
          }
        });
      }

      // Execute tool and return result
      try {
        const result = await toolHandler(args);
        return res.status(200).json({
          jsonrpc: "2.0",
          id,
          result
        });
      } catch (toolError) {
        // GitHub API errors should be returned as proper JSON-RPC errors, not 500s
        console.error(`❌ Tool '${name}' error:`, toolError.message);

        // Determine appropriate error code based on the error
        let errorCode = -32603; // Internal error (default)
        let statusCode = 200; // JSON-RPC errors use 200 with error object

        if (toolError.message.includes('Request failed with status code 403')) {
          errorCode = -32001; // Custom: Permission denied
        } else if (toolError.message.includes('Request failed with status code 404')) {
          errorCode = -32002; // Custom: Not found
        } else if (toolError.message.includes('Request failed with status code 422')) {
          errorCode = -32003; // Custom: Validation error (PR already exists)
        } else if (toolError.message.includes('rate limit exceeded')) {
          errorCode = -32004; // Custom: Rate limit exceeded
        }

        return res.status(statusCode).json({
          jsonrpc: "2.0",
          id,
          error: {
            code: errorCode,
            message: toolError.message,
            data: {
              tool: name,
              timestamp: new Date().toISOString()
            }
          }
        });
      }
    }

    // Unknown method
    return res.status(501).json({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`
      }
    });

  } catch (error) {
    console.error("❌ SSE Error:", error.message);
    return res.status(500).json({
      jsonrpc: "2.0",
      id: req.body?.id || null,
      error: {
        code: -32603,
        message: `Internal error: ${error.message}`
      }
    });
  }
});

const port = process.env.PORT || 8788;
app.listen(port, () => {
  console.log("═══════════════════════════════════════════");
  console.log("✅ GitHub MCP Enhanced v2.0 Running");
  console.log(`📍 URL: http://localhost:${port}/mcp`);
  console.log(`📍 SSE: http://localhost:${port}/sse`);
  console.log("═══════════════════════════════════════════");
  console.log("");
  console.log("🚀 Enhanced Tools Available:");
  console.log("  • search - Search repositories");
  console.log("  • fetch - Get repo metadata");
  console.log("  • list_directory - Browse folders");
  console.log("  • read_file - Read file contents");
  console.log("  • get_tree - Full repo structure");
  console.log("  • get_commits - Commit history");
  console.log("  • get_branches - List branches");
  console.log("");
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${port} is already in use. Please close the other process or use a different port.`);
    process.exit(1);
  } else {
    console.error('❌ Server error:', err);
  }
});

// Add global error handlers
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  // Don't exit - try to recover
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - try to recover
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('⚠️ SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n⚠️ SIGINT received, shutting down gracefully...');
  process.exit(0);
});