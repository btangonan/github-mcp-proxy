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
  prTemplateRequired: process.env.PR_TEMPLATE_REQUIRED === 'true',

  // PR update configuration (independent of PR creation)
  prUpdateEnabled: process.env.PR_UPDATE_ENABLED === 'true',

  // PR merge configuration
  prMergeEnabled: process.env.PR_MERGE_ENABLED === 'true',
  prMergeRateLimitMax: parseInt(process.env.PR_MERGE_RATE_LIMIT_MAX) || 5,
  prMergeRateLimitWindow: parseInt(process.env.PR_MERGE_RATE_LIMIT_WINDOW) || 60 * 60 * 1000 // 1 hour
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
if (config.prMergeEnabled) {
  console.log(`   • PR Merge: ENABLED`);
  console.log(`   • PR Merge Rate Limit: ${config.prMergeRateLimitMax} per ${config.prMergeRateLimitWindow / 60000} minutes`);
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

  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.header("Access-Control-Max-Age", "86400"); // 24 hours

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

// Parse JSON bodies with configurable size limit
app.use(express.json({ limit: config.bodySizeLimit }));

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
    const req = error.config;

    // Don't retry if we've already retried the configured number of times
    if (!req || req._retryCount >= config.githubRetryAttempts) {
      return Promise.reject(error);
    }

    req._retryCount = req._retryCount || 0;

    req._retryCount++;

    // Retry on network errors or 5xx status codes
    if (!error.response || (error.response.status >= 500 && error.response.status <= 599)) {
      console.log(`🔄 Retrying GitHub API request (attempt ${req._retryCount})`);

      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, req._retryCount - 1) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));

      return github(req);
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


// Checks/Statuses summary for a commit SHA
async function getChecksSummary(owner, repo, sha) {
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

// Tool Registry Pattern
const toolRegistry = new Map();

// Tool handler functions
...