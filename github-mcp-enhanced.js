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
  if (!branch) return 'main';
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
  const [owner, repo] = validateRepoFormat(args.id);

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

  // Log the attempt
  await auditLog('PR_CREATE_ATTEMPT', {
    repo: `${owner}/${repo}`,
    base,
    head,
    title,
    bodyLength: body.length
  });

  try {
    // Check if branches exist
    await githubRequest(`/repos/${owner}/${repo}/branches/${head}`);
    await githubRequest(`/repos/${owner}/${repo}/branches/${base}`);

    // Check for existing open PRs from this branch to avoid 422 errors
    try {
      const existingPRs = await githubRequest(`/repos/${owner}/${repo}/pulls?head=${owner}:${head}&base=${base}&state=open`);
      if (existingPRs && existingPRs.length > 0) {
        const existingPR = existingPRs[0];
        throw new Error(`PR already exists from ${head} to ${base}. See: ${existingPR.html_url} (PR #${existingPR.number})`);
      }
    } catch (prCheckError) {
      if (prCheckError.message.includes('PR already exists')) {
        throw prCheckError; // Re-throw our custom error
      }
      console.warn('⚠️ Could not check for existing PRs:', prCheckError.message);
      // Continue with PR creation if check fails
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
      title
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
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
    if (error.message.includes('404')) {
      throw new Error(`Branch not found. Ensure both '${head}' and '${base}' branches exist in ${owner}/${repo}`);
    }
    if (error.message.includes('422')) {
      throw new Error('PR already exists or invalid PR configuration');
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

// Register all tools
toolRegistry.set("search", handleSearch);
toolRegistry.set("fetch", handleFetch);
toolRegistry.set("list_directory", handleListDirectory);
toolRegistry.set("read_file", handleReadFile);
toolRegistry.set("get_tree", handleGetTree);
toolRegistry.set("get_commits", handleGetCommits);
toolRegistry.set("get_branches", handleGetBranches);

// Register PR tool only if enabled
if (config.prEnabled && config.prWhitelist.length > 0) {
  toolRegistry.set("create_pull_request", handleCreatePullRequest);
}

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
      return res.status(200).json({
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
                  id: {
                    type: "string",
                    description: "Repository name (owner/repo)"
                  }
                },
                required: ["id"]
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
            }
          ]
        }
      });
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
        github_token: !!GITHUB_TOKEN
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