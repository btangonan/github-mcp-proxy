/**
 * Middleware Module
 *
 * Express middleware for:
 * - Security (Helmet)
 * - Rate limiting
 * - CORS handling
 * - Authentication
 * - Write operation validation
 *
 * @module lib/middleware
 */

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

/**
 * Initialize and configure all middleware
 * @param {Object} app - Express application instance
 * @param {Object} config - Application configuration object
 */
function setupMiddleware(app, config) {
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
}

/**
 * Helper function to check if a tool is a write operation
 * @param {string} toolName - Name of the MCP tool
 * @returns {boolean} True if tool performs write operations
 */
function isWriteTool(toolName) {
  const writeTools = [
    "create_branch",
    "commit_files",
    "create_pull_request",
    "update_pull_request",
    "merge_pull_request",
    "create_issue",
    "update_issue",
    "add_issue_comment",
    "add_pull_request_review_comment"
  ];
  return writeTools.includes(toolName);
}

/**
 * Path-based secret validation middleware for write operations
 * Requires secret in URL path (/mcp/<SECRET>) for write operations
 * @param {Object} config - Application configuration with mcpWriteSecret
 */
function createWriteSecretValidator(config) {
  return function validateWriteSecret(req, res, next) {
    // Only enforce for write operations
    const isToolsCall = req.body?.method === "tools/call";
    const toolName = req.body?.params?.name;
    const isWrite = isToolsCall && isWriteTool(toolName);

    // If not a write operation, allow through
    if (!isWrite) {
      return next();
    }

    // Write operation detected - require secret in path
    const pathSecret = req.params.secret;

    // If no write secret is configured, reject writes entirely
    if (!config.mcpWriteSecret) {
      return res.status(200).json({
        jsonrpc: "2.0",
        id: req.body?.id || null,
        error: {
          code: -32000,
          message: "Write operations are disabled (MCP_WRITE_SECRET not configured)",
          data: { tool: toolName, timestamp: new Date().toISOString() }
        }
      });
    }

    // Check if path secret matches configured secret
    const secretMatches = pathSecret && pathSecret === config.mcpWriteSecret;

    if (!secretMatches) {
      return res.status(200).json({
        jsonrpc: "2.0",
        id: req.body?.id || null,
        error: {
          code: -32000,
          message: `Write operation '${toolName}' requires secret path. Use /mcp/<SECRET> endpoint for write operations.`,
          data: { tool: toolName, timestamp: new Date().toISOString() }
        }
      });
    }

    // Secret matches - allow write operation
    next();
  };
}

/**
 * Authentication middleware for /mcp endpoints
 * Optional auth: allows requests without token (for ChatGPT), validates if provided
 * @param {Object} config - Application configuration with mcpAuthToken
 */
function createAuthMiddleware(config) {
  return function authRequired(req, res, next) {
    // If no token configured, allow all requests
    if (!config.mcpAuthToken) {
      return next();
    }

    const authHeader = req.headers.authorization || "";

    // If no auth header provided, allow (for ChatGPT compatibility)
    if (!authHeader) {
      return next();
    }

    // If auth header IS provided, validate it (protects other clients)
    if (!authHeader.startsWith("Bearer ") || authHeader.slice(7).trim() !== config.mcpAuthToken) {
      return res.status(401).json({ error: "Unauthorized - Invalid Bearer token" });
    }

    next();
  };
}

module.exports = {
  setupMiddleware,
  isWriteTool,
  createWriteSecretValidator,
  createAuthMiddleware
};
