// Tiny shim to reuse helpers from main server without circular import hell.
const main = require('./github-mcp-enhanced.js');
module.exports = {
  githubRequest: main.__helpers.githubRequest,
  validateRepoFormat: main.__helpers.validateRepoFormat,
  validateBranch: main.__helpers.validateBranch,
  assert: main.__helpers.assert,
  isRepoWhitelisted: main.__helpers.isRepoWhitelisted,
  auditLog: main.__helpers.auditLog,
};
