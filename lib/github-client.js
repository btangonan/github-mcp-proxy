/**
 * GitHub API Client Module
 *
 * Provides a configured axios instance with:
 * - Authentication via GitHub PAT
 * - Exponential backoff retry logic (1s → 2s → 4s)
 * - Standard GitHub API headers
 * - Timeout configuration
 *
 * @module lib/github-client
 */

const axios = require("axios");
const axiosRetry = require("axios-retry").default;

/**
 * Configuration for GitHub API client
 */
const config = {
  githubToken: process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || "",
  githubApiTimeout: parseInt(process.env.GITHUB_API_TIMEOUT || "30000", 10),
  githubRetryAttempts: parseInt(process.env.GITHUB_RETRY_ATTEMPTS || "3", 10)
};

/**
 * Enhanced GitHub API client with configurable timeouts and retries
 */
const github = axios.create({
  baseURL: "https://api.github.com",
  timeout: config.githubApiTimeout,
  headers: {
    Authorization: `Bearer ${config.githubToken}`,
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "GitHub-MCP-Server/2.0"
  }
});

/**
 * Configure axios-retry with exponential backoff
 * - Retries on network errors and 5xx status codes
 * - Exponential delay: 1s → 2s → 4s
 * - Logs retry attempts for debugging
 */
axiosRetry(github, {
  retries: config.githubRetryAttempts,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    // Retry on network errors or 5xx status codes
    return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
           (error.response && error.response.status >= 500 && error.response.status <= 599);
  },
  onRetry: (retryCount, error, requestConfig) => {
    console.log(`🔄 Retrying GitHub API request (attempt ${retryCount}/${config.githubRetryAttempts}): ${error.message}`);
  },
  shouldResetTimeout: true
});

module.exports = github;
