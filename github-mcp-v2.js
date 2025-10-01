require("dotenv").config();

const express = require("express");
const axios = require("axios");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const fs = require("fs").promises;
const path = require("path");

const app = express();

// ============================================
// CONFIGURATION
// ============================================

const config = {
  // Server configuration
  port: parseInt(process.env.PORT) || 8788,
  host: process.env.HOST || 'localhost',

  // GitHub API configuration
  githubToken: process.env.GITHUB_PAT,
  githubApiTimeout: parseInt(process.env.GITHUB_API_TIMEOUT) || 45000, // Increased to 45s for ChatGPT compatibility
  githubRetryAttempts: parseInt(process.env.GITHUB_RETRY_ATTEMPTS) || 3,

  // Rate limiting configuration
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 1000,

  // Cache configuration (disabled for real-time accuracy)
  cacheTTL: 0, // Disabled
  cacheMaxSize: 0,

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

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Create structured error response with helpful hints
 */
function createError(code, message, hint = null, details = {}) {
  return {
    error: {
      code,
      message,
      hint,
      details,
      timestamp: new Date().toISOString()
    }
  };
}

/**
 * Normalize path for GitHub API (handle root cases)
 */
function normalizePath(inputPath) {
  // Accept both "/" and "" for root
  if (!inputPath || inputPath === "/" || inputPath === "." || inputPath === "./") {
    return "";
  }

  // Remove leading/trailing slashes
  let normalized = inputPath.replace(/^\/+|\/+$/g, '');

  // Prevent absolute paths (security)
  if (normalized.startsWith('/') || normalized.includes('..')) {
    throw new Error('Invalid path: absolute paths or parent directory access not allowed');
  }

  return normalized;
}

/**
 * Standardize ref parameter (accept both 'branch' and 'ref')
 */
function normalizeRef(args, defaultBranch = null) {
  // Support both 'ref' and 'branch' parameters
  const ref = args.ref || args.branch || defaultBranch;

  if (!ref && defaultBranch === null) {
    throw new Error('Reference (branch or commit) is required');
  }

  return ref || defaultBranch;
}

/**
 * Validate repository format
 */
function validateRepoFormat(repo) {
  if (!repo || typeof repo !== 'string') {
    throw new Error('Repository must be a string in format "owner/repo"');
  }

  const parts = repo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('Repository must be in format "owner/repo"');
  }

  return parts; // [owner, repo]
}

/**
 * Get default branch for a repository
 */
async function getDefaultBranch(owner, repo) {
  try {
    const response = await githubRequest(`/repos/${owner}/${repo}`);
    return response.data.default_branch || 'main';
  } catch (error) {
    console.warn(`Failed to get default branch for ${owner}/${repo}, using 'main'`);
    return 'main';
  }
}

/**
 * Enhanced GitHub API wrapper
 */
async function githubRequest(endpoint, params = {}, headers = {}, method = 'GET', data = null) {
  const requestConfig = {
    method,
    url: `https://api.github.com${endpoint}`,
    headers: {
      Authorization: `Bearer ${config.githubToken}`,
      Accept: 'application/vnd.github.v3+json',
      // Force GitHub to bypass its own cache
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'If-None-Match': '', // Explicitly clear ETag to prevent 304 responses
      ...headers
    },
    params,
    timeout: config.githubApiTimeout
  };

  if (data) {
    requestConfig.data = data;
  }

  try {
    const response = await axios(requestConfig);

    // Include rate limit info in response
    const rateLimit = {
      limit: response.headers['x-ratelimit-limit'],
      remaining: response.headers['x-ratelimit-remaining'],
      reset: response.headers['x-ratelimit-reset'] ?
        new Date(parseInt(response.headers['x-ratelimit-reset']) * 1000).toISOString() : null
    };

    return {
      data: response.data,
      meta: { rateLimit }
    };
  } catch (error) {
    // Handle specific HTTP status codes
    if (error.response?.status === 404) {
      throw new Error(`Resource not found: ${endpoint}`);
    } else if (error.response?.status === 403) {
      throw new Error(`Rate limit exceeded or permission denied`);
    } else if (error.response?.status === 401) {
      throw new Error(`Authentication failed - check your GitHub token`);
    } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      throw new Error(`GitHub API request timed out after ${config.githubApiTimeout}ms. Please try again.`);
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      throw new Error(`Unable to connect to GitHub API. Check your internet connection.`);
    }

    // For other errors, provide the original error message
    throw new Error(`GitHub API error: ${error.message}`);
  }
}

// ============================================
// TOOL HANDLERS (ENHANCED)
// ============================================

/**
 * Search repositories
 */
async function handleSearch(args) {
  const query = args.query || args.q;
  if (!query) {
    throw createError('InvalidInput', 'Search query is required',
      'Example: {"query": "user:octocat language:javascript"}');
  }

  const response = await githubRequest('/search/repositories', {
    q: query,
    sort: args.sort || 'stars',
    order: args.order || 'desc',
    per_page: args.per_page || args.limit || 10,
    page: args.page || 1
  });

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        total_count: response.data.total_count,
        items: response.data.items.map(repo => ({
          full_name: repo.full_name,
          description: repo.description,
          stars: repo.stargazers_count,
          language: repo.language,
          html_url: repo.html_url,
          api_url: repo.url,
          default_branch: repo.default_branch
        })),
        search_url: `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`,
        meta: response.meta
      })
    }]
  };
}

/**
 * Fetch repository metadata (FIXED: uses 'repo' consistently)
 */
async function handleFetch(args) {
  const [owner, repo] = validateRepoFormat(args.repo);

  const repoResponse = await githubRequest(`/repos/${owner}/${repo}`);
  const readmeResponse = await githubRequest(`/repos/${owner}/${repo}/readme`, {}, {
    Accept: "application/vnd.github.raw"
  }).catch(() => ({ data: "No README available" }));

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        name: repoResponse.data.name,
        full_name: repoResponse.data.full_name,
        description: repoResponse.data.description,
        stars: repoResponse.data.stargazers_count,
        language: repoResponse.data.language,
        created_at: repoResponse.data.created_at,
        updated_at: repoResponse.data.updated_at,
        default_branch: repoResponse.data.default_branch,
        html_url: repoResponse.data.html_url,
        api_url: repoResponse.data.url,
        readme: readmeResponse.data,
        permissions: {
          admin: repoResponse.data.permissions?.admin || false,
          push: repoResponse.data.permissions?.push || false,
          pull: repoResponse.data.permissions?.pull || true
        },
        meta: repoResponse.meta
      })
    }]
  };
}

/**
 * List directory contents (ENHANCED: handles root properly)
 */
async function handleListDirectory(args) {
  const [owner, repo] = validateRepoFormat(args.repo);
  const path = normalizePath(args.path || '');
  const defaultBranch = await getDefaultBranch(owner, repo);
  const ref = normalizeRef(args, defaultBranch);

  console.log(`📂 Listing directory: ${owner}/${repo}/${path || '(root)'} @ ${ref}`);

  const endpoint = `/repos/${owner}/${repo}/contents/${path}`;
  const response = await githubRequest(endpoint, { ref });

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        repository: args.repo,
        path: path || '/',
        ref,
        items: response.data.map(item => ({
          name: item.name,
          type: item.type,
          path: item.path,
          size: item.size,
          sha: item.sha,
          html_url: item.html_url,
          api_url: item.url,
          download_url: item.download_url
        })),
        meta: response.meta
      })
    }]
  };
}

/**
 * Read file contents (ENHANCED)
 */
async function handleReadFile(args) {
  const [owner, repo] = validateRepoFormat(args.repo);
  const path = normalizePath(args.path);

  if (!path) {
    throw createError('InvalidInput', 'File path is required',
      'Example: {"repo": "owner/repo", "path": "README.md"}');
  }

  const defaultBranch = await getDefaultBranch(owner, repo);
  const ref = normalizeRef(args, defaultBranch);

  console.log(`📖 Reading file: ${owner}/${repo}/${path} @ ${ref}`);

  const response = await githubRequest(`/repos/${owner}/${repo}/contents/${path}`, { ref });

  const content = response.data.content ?
    Buffer.from(response.data.content, 'base64').toString('utf8') : '';

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        path: response.data.path,
        name: response.data.name,
        sha: response.data.sha,
        size: response.data.size,
        content,
        encoding: response.data.encoding,
        html_url: response.data.html_url,
        api_url: response.data.url,
        meta: response.meta
      })
    }]
  };
}

/**
 * Get repository tree structure (ENHANCED)
 */
async function handleGetTree(args) {
  const [owner, repo] = validateRepoFormat(args.repo);
  const defaultBranch = await getDefaultBranch(owner, repo);
  const ref = normalizeRef(args, defaultBranch);
  const recursive = args.recursive !== false;

  const response = await githubRequest(
    `/repos/${owner}/${repo}/git/trees/${ref}`,
    { recursive: recursive ? 1 : undefined }
  );

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        repository: args.repo,
        ref,
        sha: response.data.sha,
        tree: response.data.tree.map(item => ({
          path: item.path,
          mode: item.mode,
          type: item.type,
          sha: item.sha,
          size: item.size
        })),
        truncated: response.data.truncated,
        meta: response.meta
      })
    }]
  };
}

/**
 * Get commits (ENHANCED)
 */
async function handleGetCommits(args) {
  const [owner, repo] = validateRepoFormat(args.repo);
  const defaultBranch = await getDefaultBranch(owner, repo);
  const ref = normalizeRef(args, defaultBranch);

  const params = {
    sha: ref,
    per_page: args.per_page || args.limit || 30,
    page: args.page || 1
  };

  if (args.path) {
    params.path = normalizePath(args.path);
  }
  if (args.since) {
    params.since = args.since;
  }
  if (args.until) {
    params.until = args.until;
  }

  const response = await githubRequest(`/repos/${owner}/${repo}/commits`, params);

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        repository: args.repo,
        ref,
        commits: response.data.map(commit => ({
          sha: commit.sha,
          short_sha: commit.sha.substring(0, 7),
          message: commit.commit.message,
          author: {
            name: commit.commit.author.name,
            email: commit.commit.author.email,
            date: commit.commit.author.date,
            login: commit.author?.login,
            avatar_url: commit.author?.avatar_url
          },
          html_url: commit.html_url,
          api_url: commit.url
        })),
        has_more: response.data.length === params.per_page,
        next_page: params.page + 1,
        meta: response.meta
      })
    }]
  };
}

/**
 * Get branches (ENHANCED)
 */
async function handleGetBranches(args) {
  const [owner, repo] = validateRepoFormat(args.repo);

  // First get default branch
  const repoInfo = await githubRequest(`/repos/${owner}/${repo}`);
  const defaultBranch = repoInfo.data.default_branch;

  // Then get all branches
  const response = await githubRequest(`/repos/${owner}/${repo}/branches`, {
    per_page: args.per_page || 100,
    page: args.page || 1
  });

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        repository: args.repo,
        default_branch: defaultBranch,
        branches: response.data.map(branch => ({
          name: branch.name,
          sha: branch.commit.sha,
          short_sha: branch.commit.sha.substring(0, 7),
          protected: branch.protected,
          html_url: `https://github.com/${owner}/${repo}/tree/${branch.name}`,
          api_url: branch.commit.url
        })),
        total: response.data.length,
        meta: response.meta
      })
    }]
  };
}

/**
 * Create branch (ENHANCED: supports from_ref and guards)
 */
async function handleCreateBranch(args) {
  // Check whitelist
  if (!config.prEnabled || config.prWhitelist.length === 0) {
    throw createError('Forbidden', 'Branch creation is not enabled',
      'Enable PR_ENABLED and configure PR_WHITELIST in .env');
  }

  const [owner, repo] = validateRepoFormat(args.repo);

  // Check whitelist
  const isWhitelisted = config.prWhitelist.some(pattern => {
    if (pattern.endsWith('/*')) {
      return owner === pattern.slice(0, -2);
    }
    return `${owner}/${repo}` === pattern;
  });

  if (!isWhitelisted) {
    throw createError('Forbidden', `Repository ${owner}/${repo} is not whitelisted`,
      `Add "${owner}/${repo}" or "${owner}/*" to PR_WHITELIST`);
  }

  const branchName = args.branch;
  if (!branchName) {
    throw createError('InvalidInput', 'Branch name is required',
      'Example: {"repo": "owner/repo", "branch": "feature/new-feature"}');
  }

  // Get the source ref (from_ref or from or default branch)
  const fromRef = args.from_ref || args.from;
  let sourceRef;

  if (fromRef) {
    // Verify the source ref exists
    try {
      const refCheck = await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${fromRef}`);
      sourceRef = refCheck.data.object.sha;
    } catch (e) {
      // Try as commit SHA
      try {
        const commitCheck = await githubRequest(`/repos/${owner}/${repo}/commits/${fromRef}`);
        sourceRef = commitCheck.data.sha;
      } catch (e2) {
        throw createError('NotFound', `Source ref '${fromRef}' not found`,
          'Provide a valid branch name or commit SHA');
      }
    }
  } else {
    // Use default branch
    const defaultBranch = await getDefaultBranch(owner, repo);
    const defaultRef = await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${defaultBranch}`);
    sourceRef = defaultRef.data.object.sha;
  }

  // Check if branch already exists
  try {
    await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${branchName}`);

    if (args.fail_if_exists) {
      throw createError('AlreadyExists', `Branch '${branchName}' already exists`,
        'Use a different branch name or set fail_if_exists: false');
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          created: false,
          reason: 'Branch already exists',
          branch: branchName,
          repository: args.repo
        })
      }]
    };
  } catch (e) {
    // Branch doesn't exist, create it
    const response = await githubRequest(
      `/repos/${owner}/${repo}/git/refs`,
      {},
      {},
      'POST',
      {
        ref: `refs/heads/${branchName}`,
        sha: sourceRef
      }
    );

    // Log to audit file
    if (config.prAuditLog) {
      const auditEntry = {
        timestamp: new Date().toISOString(),
        action: 'create_branch',
        repository: `${owner}/${repo}`,
        branch: branchName,
        from_ref: fromRef || 'default',
        source_sha: sourceRef
      };
      await fs.appendFile(config.prAuditLog, JSON.stringify(auditEntry) + '\n');
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          created: true,
          branch: branchName,
          sha: sourceRef,
          short_sha: sourceRef.substring(0, 7),
          repository: args.repo,
          html_url: `https://github.com/${owner}/${repo}/tree/${branchName}`,
          meta: response.meta
        })
      }]
    };
  }
}

// ... (Continue with other enhanced handlers in next message due to length)

// ============================================
// TOOL REGISTRY
// ============================================

const toolRegistry = new Map();

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
  toolRegistry.set("create_branch", handleCreateBranch);
  // Add other mutation tools here
}

// ============================================
// EXPRESS MIDDLEWARE & ROUTES
// ============================================

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimitWindow,
  max: config.rateLimitMax,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health'
});
app.use(limiter);

// CORS
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (config.allowedOrigins.includes(origin) || !origin) {
    res.header("Access-Control-Allow-Origin", origin || "*");
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.header("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    return res.status(204).send();
  }
  next();
});

// Body parsing
app.use(express.json({ limit: config.bodySizeLimit }));

// ============================================
// MCP ENDPOINTS
// ============================================

// Main MCP endpoint
app.post("/mcp", async (req, res) => {
  // Set keep-alive headers to prevent disconnections
  res.set({
    'Connection': 'keep-alive',
    'Keep-Alive': 'timeout=60, max=1000',
    'X-Content-Type-Options': 'nosniff'
  });

  try {
    const { method, params, id } = req.body;

    console.log(`📨 MCP Request: ${JSON.stringify(req.body, null, 2)}`);

    // Handle initialization
    if (method === "initialize") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
            resources: {}
          },
          serverInfo: {
            name: "github-mcp-v2",
            version: "2.0.0"
          }
        }
      });
    }

    // Handle MCP handshake (for ChatGPT compatibility)
    if (method === "mcp/handshake") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocol: "2025-03-26",
          capabilities: {
            tools: {
              supported: true
            },
            resources: {
              supported: false
            }
          },
          serverInfo: {
            name: "github-mcp-v2",
            version: "2.0.0",
            description: "GitHub MCP Server for ChatGPT integration"
          }
        }
      });
    }

    // Handle tool listing
    if (method === "tools/list") {
      const tools = Array.from(toolRegistry.keys()).map(name => {
        // Define proper schemas for each tool
        const schemas = {
          search: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
              sort: { type: "string", enum: ["stars", "forks", "updated"] },
              order: { type: "string", enum: ["asc", "desc"] },
              per_page: { type: "number", minimum: 1, maximum: 100 },
              page: { type: "number", minimum: 1 }
            },
            required: ["query"]
          },
          fetch: {
            type: "object",
            properties: {
              repo: { type: "string", description: "Repository (owner/repo)" }
            },
            required: ["repo"]
          },
          list_directory: {
            type: "object",
            properties: {
              repo: { type: "string", description: "Repository (owner/repo)" },
              path: { type: "string", description: "Directory path" },
              ref: { type: "string", description: "Branch or commit (default: main)" }
            },
            required: ["repo"]
          },
          read_file: {
            type: "object",
            properties: {
              repo: { type: "string", description: "Repository (owner/repo)" },
              path: { type: "string", description: "File path" },
              ref: { type: "string", description: "Branch or commit (default: main)" }
            },
            required: ["repo", "path"]
          },
          get_tree: {
            type: "object",
            properties: {
              repo: { type: "string", description: "Repository (owner/repo)" },
              ref: { type: "string", description: "Branch or commit (default: main)" },
              recursive: { type: "boolean", description: "Get tree recursively" }
            },
            required: ["repo"]
          },
          get_commits: {
            type: "object",
            properties: {
              repo: { type: "string", description: "Repository (owner/repo)" },
              ref: { type: "string", description: "Branch or commit (default: main)" },
              path: { type: "string", description: "Filter by path" },
              per_page: { type: "number", minimum: 1, maximum: 100 },
              page: { type: "number", minimum: 1 }
            },
            required: ["repo"]
          },
          get_branches: {
            type: "object",
            properties: {
              repo: { type: "string", description: "Repository (owner/repo)" },
              per_page: { type: "number", minimum: 1, maximum: 100 },
              page: { type: "number", minimum: 1 }
            },
            required: ["repo"]
          },
          create_branch: {
            type: "object",
            properties: {
              repo: { type: "string", description: "Repository (owner/repo)" },
              branch: { type: "string", description: "New branch name" },
              from_ref: { type: "string", description: "Source branch or commit SHA" },
              fail_if_exists: { type: "boolean", description: "Fail if branch exists" }
            },
            required: ["repo", "branch"]
          }
        };

        return {
          name,
          description: `GitHub tool: ${name}`,
          inputSchema: schemas[name] || { type: "object" }
        };
      });

      return res.json({
        jsonrpc: "2.0",
        id,
        result: { tools }
      });
    }

    // Handle tool calls
    if (method === "tools/call") {
      const { name, arguments: args } = params;
      const toolHandler = toolRegistry.get(name);

      if (!toolHandler) {
        return res.json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Unknown tool: ${name}`,
            data: createError('UnknownTool', `Tool '${name}' not found`,
              `Available tools: ${Array.from(toolRegistry.keys()).join(', ')}`)
          }
        });
      }

      try {
        const result = await toolHandler(args);
        return res.json({
          jsonrpc: "2.0",
          id,
          result
        });
      } catch (error) {
        console.error(`❌ Tool '${name}' error:`, error);

        return res.json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32603,
            message: error.message || 'Internal error',
            data: error.error || error
          }
        });
      }
    }

    // Unknown method
    return res.json({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: "Method not found"
      }
    });

  } catch (error) {
    console.error("❌ MCP endpoint error:", error);
    res.status(500).json({
      jsonrpc: "2.0",
      id: req.body?.id,
      error: {
        code: -32603,
        message: "Internal server error"
      }
    });
  }
});

// GET handler for /mcp - return 405 Method Not Allowed
app.get("/mcp", (req, res) => {
  res.status(405).set({
    "Access-Control-Allow-Origin": req.headers.origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Allow": "POST, OPTIONS"
  }).json({
    error: {
      code: "MethodNotAllowed",
      message: "GET method not supported. Use POST for MCP requests.",
      hint: "This endpoint only accepts POST requests with JSON-RPC payloads."
    }
  });
});

// SSE endpoint for ChatGPT (supports both GET and POST)
const sseHandler = async (req, res) => {
  // Set proper SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no"  // Disable buffering for immediate response
  });

  console.log("✅ SSE client connected");
  console.log("Method:", req.method);
  console.log("Body:", req.body);

  // Keep connection alive
  const keepAlive = setInterval(() => {
    res.write(":keepalive\n\n");
  }, 30000);

  // Handle SSE messages
  req.on("close", () => {
    clearInterval(keepAlive);
    console.log("🔌 SSE client disconnected");
  });

  // Process incoming data if present (from POST body or query params)
  let requestData = null;

  if (req.method === 'POST' && req.body) {
    requestData = req.body;
  } else if (req.query && req.query.data) {
    try {
      requestData = JSON.parse(req.query.data);
    } catch (e) {
      console.error("Failed to parse query data:", e);
    }
  }

  // If we have request data, process it as MCP
  if (requestData) {
    try {
      console.log(`📨 SSE MCP Request:`, requestData);
      const { method, params, id } = requestData;

      let response;

      // Handle different MCP methods
      if (method === "initialize") {
        response = {
          jsonrpc: "2.0",
          id,
          result: {
            capabilities: {
              tools: {},
              resources: {}
            },
            serverInfo: {
              name: "github-mcp-v2",
              version: "2.0.0"
            }
          }
        };
      } else if (method === "tools/list") {
        // Return the same tool list as /mcp endpoint
        const tools = Array.from(toolRegistry.keys()).map(name => ({
          name,
          description: `GitHub tool: ${name}`,
          inputSchema: getToolSchema(name)
        }));

        response = {
          jsonrpc: "2.0",
          id,
          result: { tools }
        };
      } else if (method === "tools/call") {
        // Handle tool calls
        const { name, arguments: args } = params;
        const handler = toolRegistry.get(name);

        if (!handler) {
          response = {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32601,
              message: `Tool not found: ${name}`
            }
          };
        } else {
          try {
            const result = await handler(args);
            response = {
              jsonrpc: "2.0",
              id,
              result
            };
          } catch (error) {
            response = {
              jsonrpc: "2.0",
              id,
              error: {
                code: -32000,
                message: error.message
              }
            };
          }
        }
      } else {
        response = {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          }
        };
      }

      // Send response as SSE data
      res.write(`data: ${JSON.stringify(response)}\n\n`);
    } catch (error) {
      console.error('SSE error:', error);
      res.write(`data: ${JSON.stringify({
        jsonrpc: "2.0",
        id: requestData.id,
        error: {
          code: -32000,
          message: error.message
        }
      })}\n\n`);
    }
  } else {
    // For simple GET requests without data, just send connection status
    res.write(`data: {"status": "connected", "message": "SSE endpoint ready"}\n\n`);
  }
};

// Helper function to get tool schema
const getToolSchema = (name) => {
  const schemas = {
    search: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        sort: { type: "string", enum: ["stars", "forks", "updated"] },
        order: { type: "string", enum: ["asc", "desc"] },
        per_page: { type: "number", minimum: 1, maximum: 100 },
        page: { type: "number", minimum: 1 }
      },
      required: ["query"]
    },
    fetch: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository (owner/repo)" }
      },
      required: ["repo"]
    },
    list_directory: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository (owner/repo)" },
        path: { type: "string", description: "Directory path" },
        ref: { type: "string", description: "Branch or commit (default: main)" }
      },
      required: ["repo"]
    },
    read_file: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository (owner/repo)" },
        path: { type: "string", description: "File path" },
        ref: { type: "string", description: "Branch or commit (default: main)" }
      },
      required: ["repo", "path"]
    },
    get_tree: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository (owner/repo)" },
        ref: { type: "string", description: "Branch or commit (default: main)" },
        recursive: { type: "boolean", description: "Get tree recursively" }
      },
      required: ["repo"]
    },
    get_commits: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository (owner/repo)" },
        ref: { type: "string", description: "Branch or commit (default: main)" },
        path: { type: "string", description: "Filter by path" },
        per_page: { type: "number", minimum: 1, maximum: 100 },
        page: { type: "number", minimum: 1 }
      },
      required: ["repo"]
    },
    get_branches: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository (owner/repo)" },
        per_page: { type: "number", minimum: 1, maximum: 100 },
        page: { type: "number", minimum: 1 }
      },
      required: ["repo"]
    },
    create_branch: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository (owner/repo)" },
        branch: { type: "string", description: "New branch name" },
        from_ref: { type: "string", description: "Source branch or commit SHA" },
        fail_if_exists: { type: "boolean", description: "Fail if branch exists" }
      },
      required: ["repo", "branch"]
    }
  };

  return schemas[name] || { type: "object" };
};

// Register both GET and POST handlers for SSE
app.get("/sse", sseHandler);
app.post("/sse", express.json(), sseHandler);

// Health check
app.get("/health", async (req, res) => {
  try {
    const healthData = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      capabilities: {
        tools: Array.from(toolRegistry.keys()),
        github_token: !!config.githubToken,
        pr_enabled: config.prEnabled
      }
    };
    res.json(healthData);
  } catch (error) {
    res.status(503).json({
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============================================
// SERVER STARTUP
// ============================================

/**
 * Warm up GitHub client on startup to avoid cold start delays
 */
async function warmupGitHubClient() {
  try {
    console.log("🔥 Warming up GitHub client...");
    const startTime = Date.now();

    // Make a simple API call to test connection and warm up client
    await githubRequest('/user');

    const duration = Date.now() - startTime;
    console.log(`✅ GitHub client warmed up successfully (${duration}ms)`);
  } catch (error) {
    console.warn(`⚠️ GitHub client warmup failed: ${error.message}`);
    console.warn("   Server will continue but first API calls may be slower");
  }
}

// Validate configuration
if (!config.githubToken) {
  console.error("❌ Please set GITHUB_PAT environment variable.");
  process.exit(1);
}

// Start server and warm up GitHub client
async function startServer() {
  const server = app.listen(config.port, () => {
    console.log("🚀 GitHub MCP Server v2.0 Started");
    console.log(`📋 Configuration:`);
    console.log(`   • Port: ${config.port}`);
    console.log(`   • PR Creation: ${config.prEnabled ? 'ENABLED' : 'DISABLED'}`);
    if (config.prEnabled) {
      console.log(`   • PR Whitelist: ${config.prWhitelist.join(', ')}`);
    }
    console.log(`   • Available at: http://localhost:${config.port}`);
    console.log("");
  });

  // Warm up GitHub client after server starts
  await warmupGitHubClient();

  console.log("📚 Improvements in v2.0:");
  console.log("   ✅ Consistent repo/ref parameters");
  console.log("   ✅ Root path handling (/ and '')");
  console.log("   ✅ Structured errors with hints");
  console.log("   ✅ Enhanced create_branch with from_ref");
  console.log("   ✅ Rate limit info in responses");
  console.log("   ✅ Default branch auto-detection");
  console.log("   ✅ GitHub client warmup on startup");
  console.log("");

  return server;
}

// Start the server
startServer().catch(error => {
  console.error("❌ Failed to start server:", error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('⚠️ SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

module.exports = app;