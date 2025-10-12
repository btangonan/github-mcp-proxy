/**
 * JSON Schema definitions for all MCP tool parameters
 * Uses AJV (Another JSON Validator) for validation
 */

const Ajv = require('ajv');
const addFormats = require('ajv-formats');

// Initialize AJV with strict mode and all error details
const ajv = new Ajv({
  allErrors: true,
  verbose: true,
  strict: true,
  removeAdditional: false // Don't remove additional properties for flexibility
});
addFormats(ajv);

// Common schema definitions
const ownerRepoPattern = '^[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+$';
const branchNamePattern = '^[a-zA-Z0-9._/-]+$';
const shaPattern = '^[a-f0-9]{7,40}$';

// ============================================================================
// READ TOOLS SCHEMAS
// ============================================================================

const searchSchema = {
  $id: 'search',
  type: 'object',
  required: ['query'],
  properties: {
    query: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Search query for GitHub repositories'
    },
    page: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 1,
      description: 'Page number for pagination'
    },
    per_page: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 30,
      description: 'Results per page'
    }
  },
  additionalProperties: false
};

const fetchSchema = {
  $id: 'fetch',
  type: 'object',
  required: ['repo'],
  properties: {
    repo: {
      type: 'string',
      pattern: ownerRepoPattern,
      description: 'Repository in format owner/repo'
    }
  },
  additionalProperties: false
};

const listDirectorySchema = {
  $id: 'list_directory',
  type: 'object',
  required: ['repo', 'path'],
  properties: {
    repo: {
      type: 'string',
      pattern: ownerRepoPattern,
      description: 'Repository in format owner/repo'
    },
    path: {
      type: 'string',
      maxLength: 500,
      description: 'Path to directory (no .. or leading /)'
    },
    branch: {
      type: 'string',
      pattern: branchNamePattern,
      maxLength: 100,
      description: 'Branch name (required if not using ref)'
    },
    ref: {
      type: 'string',
      maxLength: 100,
      description: 'Git ref (branch, tag, or commit SHA)'
    }
  },
  additionalProperties: false
};

const readFileSchema = {
  $id: 'read_file',
  type: 'object',
  required: ['repo', 'path'],
  properties: {
    repo: {
      type: 'string',
      pattern: ownerRepoPattern,
      description: 'Repository in format owner/repo'
    },
    path: {
      type: 'string',
      minLength: 1,
      maxLength: 500,
      description: 'Path to file (no .. or leading /)'
    },
    branch: {
      type: 'string',
      pattern: branchNamePattern,
      maxLength: 100,
      description: 'Branch name'
    },
    ref: {
      type: 'string',
      maxLength: 100,
      description: 'Git ref (branch, tag, or commit SHA)'
    }
  },
  additionalProperties: false
};

const getTreeSchema = {
  $id: 'get_tree',
  type: 'object',
  required: ['repo'],
  properties: {
    repo: {
      type: 'string',
      pattern: ownerRepoPattern,
      description: 'Repository in format owner/repo'
    },
    branch: {
      type: 'string',
      pattern: branchNamePattern,
      maxLength: 100,
      description: 'Branch name'
    },
    ref: {
      type: 'string',
      maxLength: 100,
      description: 'Git ref'
    }
  },
  additionalProperties: false
};

const getCommitsSchema = {
  $id: 'get_commits',
  type: 'object',
  required: ['repo'],
  properties: {
    repo: {
      type: 'string',
      pattern: ownerRepoPattern,
      description: 'Repository in format owner/repo'
    },
    branch: {
      type: 'string',
      pattern: branchNamePattern,
      maxLength: 100,
      description: 'Branch name'
    },
    sha: {
      type: 'string',
      pattern: shaPattern,
      description: 'Commit SHA to start from'
    },
    page: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 1
    },
    per_page: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 30
    }
  },
  additionalProperties: false
};

const getBranchesSchema = {
  $id: 'get_branches',
  type: 'object',
  required: ['repo'],
  properties: {
    repo: {
      type: 'string',
      pattern: ownerRepoPattern,
      description: 'Repository in format owner/repo'
    },
    page: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 1
    },
    per_page: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 30
    }
  },
  additionalProperties: false
};

const listPullRequestsSchema = {
  $id: 'list_pull_requests',
  type: 'object',
  required: ['repo'],
  properties: {
    repo: {
      type: 'string',
      pattern: ownerRepoPattern,
      description: 'Repository in format owner/repo'
    },
    state: {
      type: 'string',
      enum: ['open', 'closed', 'all'],
      default: 'open',
      description: 'PR state filter'
    },
    page: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 1
    },
    per_page: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 30
    }
  },
  additionalProperties: false
};

const getPrMergeabilitySchema = {
  $id: 'get_pr_mergeability',
  type: 'object',
  required: ['repo', 'prNumber'],
  properties: {
    repo: {
      type: 'string',
      pattern: ownerRepoPattern,
      description: 'Repository in format owner/repo'
    },
    prNumber: {
      type: 'integer',
      minimum: 1,
      description: 'Pull request number'
    }
  },
  additionalProperties: false
};

const getChecksForShaSchema = {
  $id: 'get_checks_for_sha',
  type: 'object',
  required: ['repo', 'sha'],
  properties: {
    repo: {
      type: 'string',
      pattern: ownerRepoPattern,
      description: 'Repository in format owner/repo'
    },
    sha: {
      type: 'string',
      pattern: shaPattern,
      description: 'Commit SHA to check'
    }
  },
  additionalProperties: false
};

// ============================================================================
// WRITE TOOLS SCHEMAS
// ============================================================================

const createPullRequestSchema = {
  $id: 'create_pull_request',
  type: 'object',
  required: ['repo', 'title', 'head', 'base'],
  properties: {
    repo: {
      type: 'string',
      pattern: ownerRepoPattern,
      description: 'Repository in format owner/repo'
    },
    title: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'PR title'
    },
    body: {
      type: 'string',
      maxLength: 10000,
      description: 'PR description'
    },
    head: {
      type: 'string',
      pattern: branchNamePattern,
      maxLength: 100,
      description: 'Source branch name'
    },
    base: {
      type: 'string',
      pattern: branchNamePattern,
      maxLength: 100,
      description: 'Target branch name'
    },
    draft: {
      type: 'boolean',
      default: false,
      description: 'Create as draft PR'
    }
  },
  additionalProperties: false
};

const updatePullRequestSchema = {
  $id: 'update_pull_request',
  type: 'object',
  required: ['repo', 'prNumber'],
  properties: {
    repo: {
      type: 'string',
      pattern: ownerRepoPattern,
      description: 'Repository in format owner/repo'
    },
    prNumber: {
      type: 'integer',
      minimum: 1,
      description: 'Pull request number'
    },
    title: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'New PR title'
    },
    body: {
      type: 'string',
      maxLength: 10000,
      description: 'New PR description'
    },
    state: {
      type: 'string',
      enum: ['open', 'closed'],
      description: 'New PR state'
    },
    draft: {
      type: 'boolean',
      description: 'Update draft status'
    }
  },
  additionalProperties: false
};

const mergePullRequestSchema = {
  $id: 'merge_pull_request',
  type: 'object',
  required: ['repo', 'prNumber'],
  properties: {
    repo: {
      type: 'string',
      pattern: ownerRepoPattern,
      description: 'Repository in format owner/repo'
    },
    prNumber: {
      type: 'integer',
      minimum: 1,
      description: 'Pull request number'
    },
    merge_method: {
      type: 'string',
      enum: ['merge', 'squash', 'rebase'],
      default: 'merge',
      description: 'Merge method'
    },
    commit_title: {
      type: 'string',
      maxLength: 256,
      description: 'Merge commit title'
    },
    commit_message: {
      type: 'string',
      maxLength: 10000,
      description: 'Merge commit message'
    },
    sha: {
      type: 'string',
      pattern: shaPattern,
      description: 'HEAD SHA for safety check'
    },
    delete_branch: {
      type: 'boolean',
      default: false,
      description: 'Delete source branch after merge'
    }
  },
  additionalProperties: false
};

const commitFilesSchema = {
  $id: 'commit_files',
  type: 'object',
  required: ['repo', 'branch', 'message', 'files'],
  properties: {
    repo: {
      type: 'string',
      pattern: ownerRepoPattern,
      description: 'Repository in format owner/repo'
    },
    branch: {
      type: 'string',
      pattern: branchNamePattern,
      maxLength: 100,
      description: 'Branch name'
    },
    message: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Commit message'
    },
    files: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path: {
            type: 'string',
            minLength: 1,
            maxLength: 500,
            description: 'File path'
          },
          content: {
            type: 'string',
            description: 'File content'
          },
          encoding: {
            type: 'string',
            enum: ['utf8', 'base64'],
            default: 'utf8',
            description: 'Content encoding'
          }
        },
        additionalProperties: false
      },
      description: 'Files to commit'
    }
  },
  additionalProperties: false
};

// ============================================================================
// COMPILE SCHEMAS AND EXPORT VALIDATORS
// ============================================================================

// Compile all schemas
const validators = {
  // Read tools
  search: ajv.compile(searchSchema),
  fetch: ajv.compile(fetchSchema),
  list_directory: ajv.compile(listDirectorySchema),
  read_file: ajv.compile(readFileSchema),
  get_tree: ajv.compile(getTreeSchema),
  get_commits: ajv.compile(getCommitsSchema),
  get_branches: ajv.compile(getBranchesSchema),
  list_pull_requests: ajv.compile(listPullRequestsSchema),
  get_pr_mergeability: ajv.compile(getPrMergeabilitySchema),
  get_checks_for_sha: ajv.compile(getChecksForShaSchema),

  // Write tools
  create_pull_request: ajv.compile(createPullRequestSchema),
  update_pull_request: ajv.compile(updatePullRequestSchema),
  merge_pull_request: ajv.compile(mergePullRequestSchema),
  commit_files: ajv.compile(commitFilesSchema)
};

/**
 * Validate tool parameters against JSON schema
 * @param {string} toolName - Name of the MCP tool
 * @param {object} params - Parameters to validate
 * @returns {{valid: boolean, errors: array|null}} Validation result
 */
function validateToolParams(toolName, params) {
  const validator = validators[toolName];

  if (!validator) {
    return {
      valid: false,
      errors: [{
        message: `Unknown tool: ${toolName}`,
        path: 'toolName',
        value: toolName
      }]
    };
  }

  const valid = validator(params);

  if (!valid) {
    // Format AJV errors for better readability
    const errors = validator.errors.map(err => ({
      message: err.message,
      path: err.instancePath || err.dataPath || 'root',
      keyword: err.keyword,
      params: err.params,
      value: err.data
    }));

    return { valid: false, errors };
  }

  return { valid: true, errors: null };
}

/**
 * Format validation errors as human-readable message
 * @param {array} errors - Validation errors from AJV
 * @returns {string} Formatted error message
 */
function formatValidationErrors(errors) {
  if (!errors || errors.length === 0) {
    return 'Invalid parameters';
  }

  const messages = errors.map(err => {
    const path = err.path === 'root' ? '' : ` at ${err.path}`;
    return `${err.message}${path}`;
  });

  return `Validation errors: ${messages.join('; ')}`;
}

module.exports = {
  validators,
  validateToolParams,
  formatValidationErrors,
  // Export schemas for testing
  schemas: {
    search: searchSchema,
    fetch: fetchSchema,
    list_directory: listDirectorySchema,
    read_file: readFileSchema,
    get_tree: getTreeSchema,
    get_commits: getCommitsSchema,
    get_branches: getBranchesSchema,
    list_pull_requests: listPullRequestsSchema,
    get_pr_mergeability: getPrMergeabilitySchema,
    get_checks_for_sha: getChecksForShaSchema,
    create_pull_request: createPullRequestSchema,
    update_pull_request: updatePullRequestSchema,
    merge_pull_request: mergePullRequestSchema,
    commit_files: commitFilesSchema
  }
};
