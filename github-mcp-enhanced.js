require("dotenv").config();

const express = require("express");
const { validateToolParams, formatValidationErrors } = require("./mcp-tool-schemas");
const github = require("./lib/github-client");
const { setupMiddleware, isWriteTool, createWriteSecretValidator, createAuthMiddleware } = require("./lib/middleware");

// Import tool handlers
const readTools = require("./lib/tools/read-tools");
const writeTools = require("./lib/tools/write-tools");
const prTools = require("./lib/tools/pr-tools");

const app = express();

// Configuration from environment variables
const config = {
  // Server configuration
  port: parseInt(process.env.PORT) || 8788,
  host: process.env.HOST || 'localhost',

  // Rate limiting configuration
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 1000,

  // Cache configuration
  cacheTTL: parseInt(process.env.CACHE_TTL) || 5 * 60 * 1000, // 5 minutes
  cacheMaxSize: parseInt(process.env.CACHE_MAX_SIZE) || 1000,

  // Security configuration
  bodySizeLimit: process.env.BODY_SIZE_LIMIT || '10mb',
  enableTrustProxy: process.env.TRUST_PROXY === 'true',
  mcpAuthToken: process.env.MCP_AUTH_TOKEN,
  mcpWriteSecret: process.env.MCP_WRITE_SECRET,

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
  prTemplateRequired: process.env.PR_TEMPLATE_REQUIRED === 'true',

  // PR update configuration (independent of PR creation)
  prUpdateEnabled: process.env.PR_UPDATE_ENABLED === 'true',

  // PR merge configuration
  prMergeEnabled: process.env.PR_MERGE_ENABLED === 'true',
  prMergeRateLimitMax: parseInt(process.env.PR_MERGE_RATE_LIMIT_MAX) || 5,
  prMergeRateLimitWindow: parseInt(process.env.PR_MERGE_RATE_LIMIT_WINDOW) || 60 * 60 * 1000 // 1 hour
};

// Validate required configuration
const githubToken = process.env.GITHUB_PAT || process.env.GITHUB_TOKEN;
if (!githubToken) {
  console.error("❌ Please set GITHUB_PAT environment variable.");
  process.exit(1);
}

console.log("📋 Server Configuration:");
console.log(`   • Port: ${config.port}`);
console.log(`   • Cache TTL: ${config.cacheTTL / 1000}s`);
console.log(`   • Rate Limit: ${config.rateLimitMax} requests per ${config.rateLimitWindow / 60000} minutes`);
if (config.prEnabled) {
  console.log(`   • PR Creation: ENABLED`);
  console.log(`   • PR Whitelist: ${config.prWhitelist.length > 0 ? config.prWhitelist.join(', ') : 'None (disabled)'}`);
  console.log(`   • PR Rate Limit: ${config.prRateLimitMax} per ${config.prRateLimitWindow / 60000} minutes`);
}
if (config.prMergeEnabled) {
  console.log(`   • PR Merge: ENABLED`);
  console.log(`   • PR Merge Rate Limit: ${config.prMergeRateLimitMax} per ${config.prMergeRateLimitWindow / 60000} minutes`);
}
console.log("");

// Setup all middleware (security, rate limiting, CORS, JSON parsing)
setupMiddleware(app, config);

// Create middleware instances with config
const validateWriteSecret = createWriteSecretValidator(config);
const authRequired = createAuthMiddleware(config);

// Simple in-memory cache with configurable TTL
const cache = new Map();

// PR rate limiting tracker
const prRateLimiter = new Map();
const prMergeRateLimiter = new Map();

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

// GitHub API client is now imported from lib/github-client.js

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

// Input validation caps
function validateTitle(title) {
  assert(title && typeof title === 'string', 'Title must be a non-empty string');
  assert(title.length >= 1 && title.length <= 256, 'Title must be between 1 and 256 characters');
  return safeString(title, 256);
}

function validateBody(body) {
  if (!body) return '';
  assert(body.length <= 10000, 'Body must not exceed 10,000 characters');
  return safeString(body, 10000);
}

function validateFiles(files) {
  assert(Array.isArray(files), 'Files must be an array');
  assert(files.length > 0 && files.length <= 20, 'Files array must contain 1-20 files');

  return files.map((file, idx) => {
    assert(file.path && typeof file.path === 'string', `File ${idx}: path is required`);
    assert(file.content && typeof file.content === 'string', `File ${idx}: content is required`);

    const safePath = validatePath(file.path);
    const contentSize = Buffer.byteLength(file.content, 'utf8');
    assert(contentSize <= 256 * 1024, `File ${idx} (${safePath}): size must not exceed 256 KB`);

    return {
      path: safePath,
      content: file.content,
      encoding: file.encoding || 'utf8'
    };
  });
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
  if (config.prWhitelist.length === 0) return false;
  const full = `${owner}/${repo}`;
  return config.prWhitelist.some(pat => {
    // exact
    if (pat === full) return true;
    // owner/* prefix
    if (pat.endsWith('/*')) return full.startsWith(pat.slice(0, -1));
    // simple wildcard support
    const rx = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return rx.test(full);
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

// Generic rate limit helper
function checkRateLimitCustom(windowMs, maxCount, limiterMap, keyPrefix, identifier) {
  const now = Date.now();
  const key = `${keyPrefix}_${identifier}`;

  // Clean old entries
  for (const [k, v] of limiterMap.entries()) {
    if (now - v.timestamp > windowMs) {
      limiterMap.delete(k);
    }
  }

  const entry = limiterMap.get(key);
  if (!entry) {
    limiterMap.set(key, { count: 1, timestamp: now });
    return true;
  }

  if (now - entry.timestamp > windowMs) {
    limiterMap.set(key, { count: 1, timestamp: now });
    return true;
  }

  if (entry.count >= maxCount) {
    return false;
  }

  entry.count++;
  return true;
}


// All tool handlers now imported from lib/tools/ modules
// - Read tools: lib/tools/read-tools.js
// - Write tools: lib/tools/write-tools.js
// - PR tools: lib/tools/pr-tools.js

// Helper: Create JSON-RPC error response with HTTP 200 to prevent transport errors
function jsonRpcError(res, id, code, message, data = {}) {
  return res.status(200).json({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      data: {
        ...data,
        timestamp: new Date().toISOString()
      }
    }
  });
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
    } else {
      // Support bodies for POST, PUT, PATCH, DELETE where applicable
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
    const status = error?.response?.status;
    if (status && !error.statusCode) error.statusCode = status; // normalize for callers
    console.error(`❌ GitHub API error for ${method} ${endpoint}:`, status, error.message);
    throw error;
  }
}

// ============================================================================
// Tool Registry Setup - Must come AFTER all helper functions are defined
// ============================================================================

// Tool Registry Pattern
const toolRegistry = new Map();

// Create dependency injection context for tools
const toolContext = {
  config,
  github,
  githubRequest,
  // Validation functions
  assert,
  safeString,
  validateTitle,
  validateBody,
  validateFiles,
  validateRepoFormat,
  validatePath,
  validateBranch,
  // Whitelist and rate limiting
  isRepoWhitelisted,
  checkPRRateLimit,
  checkRateLimitCustom,
  // Audit logging
  auditLog,
  // Helpers from prTools
  getChecksSummary: prTools.getChecksSummary,
  waitForMergeable: prTools.waitForMergeable,
  // Maps for rate limiting
  prRateLimiter,
  prMergeRateLimiter
};

// Wrap tool handlers to inject dependencies
function wrapToolHandler(handler) {
  return async (args) => handler(args, toolContext);
}

// Register read tools from lib/tools/read-tools.js
toolRegistry.set("search", wrapToolHandler(readTools.handleSearch));
toolRegistry.set("fetch", wrapToolHandler(readTools.handleFetch));
toolRegistry.set("list_directory", wrapToolHandler(readTools.handleListDirectory));
toolRegistry.set("read_file", wrapToolHandler(readTools.handleReadFile));
toolRegistry.set("get_tree", wrapToolHandler(readTools.handleGetTree));
toolRegistry.set("get_commits", wrapToolHandler(readTools.handleGetCommits));
toolRegistry.set("get_branches", wrapToolHandler(readTools.handleGetBranches));

// Register write tools from lib/tools/write-tools.js (only if enabled)
if (config.prEnabled && config.prWhitelist.length > 0) {
  toolRegistry.set("create_pull_request", wrapToolHandler(writeTools.handleCreatePullRequest));
  toolRegistry.set("create_branch", wrapToolHandler(writeTools.handleCreateBranch));
  toolRegistry.set("commit_files", wrapToolHandler(writeTools.handleCommitFiles));
}

// Register PR tools from lib/tools/pr-tools.js
toolRegistry.set("list_pull_requests", wrapToolHandler(prTools.handleListPullRequests));
toolRegistry.set("search_pull_requests", wrapToolHandler(prTools.handleSearchPullRequests));
toolRegistry.set("get_pull_request", wrapToolHandler(prTools.handleGetPullRequest));
toolRegistry.set("update_pull_request", wrapToolHandler(prTools.handleUpdatePullRequest));
toolRegistry.set("merge_pull_request", wrapToolHandler(prTools.handleMergePullRequest));
toolRegistry.set("get_pr_mergeability", wrapToolHandler(prTools.handleGetPRMergeability));
toolRegistry.set("get_checks_for_sha", wrapToolHandler(prTools.handleGetChecksForSha));

console.log(`✅ Tool registry initialized with ${toolRegistry.size} tools`);

// ============================================================================
// MCP Request Handlers
// ============================================================================

// Shared MCP handler function
const mcpHandler = async (req, res) => {
  const safeReq = JSON.parse(JSON.stringify(req.body || {}));
  if (safeReq?.params?.arguments?.body) {
    safeReq.params.arguments.body = `[${String(safeReq.params.arguments.body).length} chars]`;
  }
  console.log("📨 MCP Request:", JSON.stringify(safeReq, null, 2));

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
                    description: "Branch name"
                  },
                  ref: {
                    type: "string",
                    description: "Branch, tag, or commit SHA (alternative to branch)"
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
                    description: "Branch name"
                  },
                  ref: {
                    type: "string",
                    description: "Branch, tag, or commit SHA (alternative to branch)"
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
                    description: "Branch name"
                  },
                  ref: {
                    type: "string",
                    description: "Branch, tag, or commit SHA (alternative to branch)"
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
                  branch: {
                    type: "string",
                    description: "Branch name"
                  },
                  ref: {
                    type: "string",
                    description: "Branch, tag, or commit SHA (alternative to branch)"
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

        // Extend PR tools with update and, if enabled, merge
        prTools.push({
          name: "update_pull_request",
          description: "Update a pull request: flip draft (ready-for-review), edit title/body/base/state, optionally add reviewers",
          inputSchema: {
            type: "object",
            properties: {
              repo: { type: "string", description: "Repository (owner/repo)" },
              prNumber: { type: "number", description: "Pull request number" },
              title: { type: "string", description: "New title" },
              body: { type: "string", description: "New body/description" },
              state: { type: "string", description: "PR state: open|closed" },
              draft: { type: "boolean", description: "Set draft state (false to mark ready for review)" },
              base: { type: "string", description: "Change base branch" },
              maintainer_can_modify: { type: "boolean", description: "Allow maintainers to modify" },
              reviewers: {
                type: "array",
                description: "Logins to request review from",
                items: { type: "string" }
              }
            },
            required: ["repo", "prNumber"]
          }
        });

        if (config.prMergeEnabled) {
          prTools.push({
            name: "merge_pull_request",
            description: "Merge a pull request after verifying mergeability and branch protections. Does not bypass protections.",
            inputSchema: {
              type: "object",
              properties: {
                repo: { type: "string", description: "Repository (owner/repo)" },
                prNumber: { type: "number", description: "Pull request number" },
                merge_method: { type: "string", enum: ["merge","squash","rebase"], description: "Merge strategy (default: squash)" },
                commit_title: { type: "string", description: "Optional merge commit title" },
                commit_message: { type: "string", description: "Optional merge commit message" },
                sha: { type: "string", description: "Head SHA guard for safety (required to prevent race conditions)" },
                delete_branch: { type: "boolean", description: "Delete head branch after successful merge (default: false)" }
              },
              required: ["repo", "prNumber", "sha"]
            }
          });
        }

        result.result.tools.push(...prTools);
      }

      // If PR creation is disabled, expose update/merge tools individually when enabled
      if (!config.prEnabled) {
        if (config.prMergeEnabled) {
          result.result.tools.push({
            name: "merge_pull_request",
            description: "Merge a pull request if mergeable. Respects protections, flags, whitelist, and rate limits.",
            inputSchema: {
              type: "object",
              properties: {
                repo: { type: "string", description: "owner/name" },
                prNumber: { type: "integer" },
                merge_method: { type: "string", enum: ["merge","squash","rebase"], default: "squash" },
                sha: { type: "string", description: "Head SHA guard for safety (required)" },
                commit_title: { type: "string", maxLength: 256 },
                commit_message: { type: "string", maxLength: 5000 },
                delete_branch: { type: "boolean", default: false }
              },
              required: ["repo", "prNumber", "sha"]
            }
          });
        }
        if (config.prUpdateEnabled) {
          result.result.tools.push({
            name: "update_pull_request",
            description: "Update PR metadata or reviewers.",
            inputSchema: {
              type: "object",
              properties: {
                repo: { type: "string" },
                prNumber: { type: "integer" },
                title: { type: "string", maxLength: 256 },
                body: { type: "string", maxLength: 5000 },
                state: { type: "string", enum: ["open","closed"] },
                draft: { type: "boolean" },
                base: { type: "string" },
                maintainer_can_modify: { type: "boolean" },
                reviewers: { type: "array", items: { type: "string" } }
              },
              required: ["repo","prNumber"]
            }
          });
        }
      }

      // Read helpers are always exposed
      result.result.tools.push(
        {
          name: "get_pr_mergeability",
          description: "Fetch PR mergeability, state, and checks summary.",
          inputSchema: {
            type: "object",
            properties: {
              repo: { type: "string", description: "owner/name" },
              prNumber: { type: "integer", description: "Pull request number" }
            },
            required: ["repo", "prNumber"]
          }
        },
        {
          name: "get_checks_for_sha",
          description: "Get combined statuses and check runs for a commit SHA.",
          inputSchema: {
            type: "object",
            properties: {
              repo: { type: "string", description: "owner/name" },
              sha: { type: "string", description: "Commit SHA (at least 7 characters)" }
            },
            required: ["repo", "sha"]
          }
        }
      );

      // Filter write tools if secret not provided in path
      const hasWriteAccess = req.params.secret && req.params.secret === config.mcpWriteSecret;
      if (!hasWriteAccess) {
        result.result.tools = result.result.tools.filter(tool => !isWriteTool(tool.name));
      }

      return res.json(result);
    }

    // Helper to classify tool errors to JSON-RPC codes (HTTP 200 always)
    function classifyToolError(name, errMsg) {
      const msg = String(errMsg || "").toLowerCase();
      // Specific merge semantics
      if (name === "merge_pull_request") {
        if (msg.includes("head sha mismatch")) return -32006; // stale SHA guard
        if (msg.includes("pr not mergeable")) return -32005;   // dirty/protections
      }
      // Existing families
      if (msg.includes("status code 403") || msg.includes("permission denied")) return -32001;
      if (msg.includes("status code 404") || msg.includes("not found")) return -32002;
      if (msg.includes("status code 422") || msg.includes("validation")) return -32003;
      if (msg.includes("rate limit")) return -32004;
      return -32603; // internal
    }

    // Handle tool calls
    if (method === "tools/call") {
      try {
        const { name, arguments: args } = params;

        // Validate tool parameters with JSON Schema
        const validation = validateToolParams(name, args || {});
        if (!validation.valid) {
          const errorMessage = formatValidationErrors(validation.errors);
          console.error(`❌ Schema validation failed for tool "${name}":`, errorMessage);
          return jsonRpcError(res, id, -32602, errorMessage, {
            tool: name,
            validation_errors: validation.errors
          });
        }

        // Use tool registry for cleaner code organization
        const toolHandler = toolRegistry.get(name);

        if (!toolHandler) {
          // Return HTTP 200 with JSON-RPC error (not 404) to prevent transport failures
          return jsonRpcError(res, id, -32601, `Unknown tool: ${name}`, { tool: name });
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
        const code = classifyToolError(params?.name, error.message);
        return res.status(200).json({
          jsonrpc: "2.0",
          id,
          error: {
            code,
            message: `Invalid params: ${error.message}`,
            data: { tool: params?.name, timestamp: new Date().toISOString() }
          }
        });
      }
    }

    // Unknown method - return HTTP 200 with JSON-RPC error
    return jsonRpcError(res, id, -32601, `Method not found: ${method}`, { method });

  } catch (error) {
    console.error("❌ Error:", error.message);
    // Return HTTP 200 with JSON-RPC error to prevent transport failures
    return jsonRpcError(res, req.body?.id || null, -32603, `Internal error: ${error.message}`, {});
  }
};

// MCP endpoint routing
// /mcp for read-only operations
// /mcp/:secret for write operations (when MCP_WRITE_SECRET is configured)
app.post("/mcp", authRequired, validateWriteSecret, mcpHandler);
app.post("/mcp/:secret", authRequired, validateWriteSecret, mcpHandler);

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
      },
      config: {
        prEnabled: config.prEnabled,
        prMergeEnabled: config.prMergeEnabled,
        prUpdateEnabled: config.prUpdateEnabled,
        prWhitelist: config.prWhitelist
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
  const safeReq = JSON.parse(JSON.stringify(req.body || {}));
  if (safeReq?.params?.arguments?.body) {
    safeReq.params.arguments.body = `[${String(safeReq.params.arguments.body).length} chars]`;
  }
  console.log("📨 SSE MCP Request:", JSON.stringify(safeReq, null, 2));

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

    // Helper to classify tool errors to JSON-RPC codes (HTTP 200 always)
    function classifyToolError(name, errMsg) {
      const msg = String(errMsg || "").toLowerCase();
      if (name === "merge_pull_request") {
        if (msg.includes("head sha mismatch")) return -32006;
        if (msg.includes("pr not mergeable")) return -32005;
      }
      if (msg.includes("status code 403") || msg.includes("permission denied")) return -32001;
      if (msg.includes("status code 404") || msg.includes("not found")) return -32002;
      if (msg.includes("status code 422") || msg.includes("validation")) return -32003;
      if (msg.includes("rate limit")) return -32004;
      return -32603;
    }

    // Handle tool calls using registry
    if (method === "tools/call") {
      const { name, arguments: args } = params;
      const toolHandler = toolRegistry.get(name);

      if (!toolHandler) {
        return res.status(200).json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Unknown tool: ${name}`,
            data: { tool: name, timestamp: new Date().toISOString() }
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

        // Classify to JSON-RPC error code (HTTP 200)
        const errorCode = classifyToolError(name, toolError.message);
        const statusCode = 200;

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

// Only start server if not being required as a module
if (require.main === module) {
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
}

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

// Export app for testing
module.exports = app;