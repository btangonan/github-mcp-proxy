/**
 * Unit tests for JSON Schema validation (mcp-tool-schemas.js)
 * Tests all 14 MCP tool schemas with valid and invalid inputs
 */

const {
  validateToolParams,
  formatValidationErrors,
  schemas
} = require('../../mcp-tool-schemas');

describe('JSON Schema Validation', () => {

  // ============================================================================
  // CORE VALIDATION FUNCTIONS
  // ============================================================================

  describe('validateToolParams function', () => {
    test('should return valid:true for valid params', () => {
      const result = validateToolParams('search', { query: 'test' });
      expect(result.valid).toBe(true);
      expect(result.errors).toBeNull();
    });

    test('should return valid:false for missing required params', () => {
      const result = validateToolParams('search', {});
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('should return error for unknown tool', () => {
      const result = validateToolParams('unknown_tool', {});
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors[0].message).toContain('Unknown tool');
    });

    test('should handle null params', () => {
      const result = validateToolParams('search', null);
      expect(result.valid).toBe(false);
    });

    test('should handle undefined params', () => {
      const result = validateToolParams('search', undefined);
      expect(result.valid).toBe(false);
    });
  });

  describe('formatValidationErrors function', () => {
    test('should format single error', () => {
      const errors = [{
        message: 'must have required property \'query\'',
        path: 'root',
        keyword: 'required'
      }];
      const formatted = formatValidationErrors(errors);
      expect(formatted).toContain('must have required property');
    });

    test('should format multiple errors', () => {
      const errors = [
        { message: 'error 1', path: 'root' },
        { message: 'error 2', path: '/field' }
      ];
      const formatted = formatValidationErrors(errors);
      expect(formatted).toContain('error 1');
      expect(formatted).toContain('error 2');
    });

    test('should handle empty errors array', () => {
      const formatted = formatValidationErrors([]);
      expect(formatted).toBe('Invalid parameters');
    });

    test('should handle null errors', () => {
      const formatted = formatValidationErrors(null);
      expect(formatted).toBe('Invalid parameters');
    });
  });

  // ============================================================================
  // READ TOOLS SCHEMAS
  // ============================================================================

  describe('search schema', () => {
    test('should accept valid search params', () => {
      const result = validateToolParams('search', { query: 'test' });
      expect(result.valid).toBe(true);
    });

    test('should accept optional pagination params', () => {
      const result = validateToolParams('search', {
        query: 'test',
        page: 1,
        per_page: 30
      });
      expect(result.valid).toBe(true);
    });

    test('should reject empty query', () => {
      const result = validateToolParams('search', { query: '' });
      expect(result.valid).toBe(false);
    });

    test('should reject query too long', () => {
      const result = validateToolParams('search', { query: 'x'.repeat(300) });
      expect(result.valid).toBe(false);
    });

    test('should reject invalid page number', () => {
      const result = validateToolParams('search', { query: 'test', page: 0 });
      expect(result.valid).toBe(false);
    });

    test('should reject additional properties', () => {
      const result = validateToolParams('search', {
        query: 'test',
        invalid_field: 'value'
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('fetch schema', () => {
    test('should accept valid repo format', () => {
      const result = validateToolParams('fetch', { repo: 'owner/repo' });
      expect(result.valid).toBe(true);
    });

    test('should accept repo with dots and dashes', () => {
      const result = validateToolParams('fetch', { repo: 'my-org/my.repo-name' });
      expect(result.valid).toBe(true);
    });

    test('should reject missing repo', () => {
      const result = validateToolParams('fetch', {});
      expect(result.valid).toBe(false);
    });

    test('should reject invalid repo format', () => {
      const result = validateToolParams('fetch', { repo: 'invalid' });
      expect(result.valid).toBe(false);
    });

    test('should reject repo with spaces', () => {
      const result = validateToolParams('fetch', { repo: 'owner/ repo' });
      expect(result.valid).toBe(false);
    });
  });

  describe('list_directory schema', () => {
    test('should accept valid directory params', () => {
      const result = validateToolParams('list_directory', {
        repo: 'owner/repo',
        path: 'src'
      });
      expect(result.valid).toBe(true);
    });

    test('should accept branch parameter', () => {
      const result = validateToolParams('list_directory', {
        repo: 'owner/repo',
        path: 'src',
        branch: 'main'
      });
      expect(result.valid).toBe(true);
    });

    test('should accept ref parameter', () => {
      const result = validateToolParams('list_directory', {
        repo: 'owner/repo',
        path: 'src',
        ref: 'v1.0.0'
      });
      expect(result.valid).toBe(true);
    });

    test('should reject missing required params', () => {
      const result = validateToolParams('list_directory', { repo: 'owner/repo' });
      expect(result.valid).toBe(false);
    });

    test('should reject path too long', () => {
      const result = validateToolParams('list_directory', {
        repo: 'owner/repo',
        path: 'x'.repeat(600)
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('read_file schema', () => {
    test('should accept valid file params', () => {
      const result = validateToolParams('read_file', {
        repo: 'owner/repo',
        path: 'README.md'
      });
      expect(result.valid).toBe(true);
    });

    test('should accept nested file path', () => {
      const result = validateToolParams('read_file', {
        repo: 'owner/repo',
        path: 'src/components/Button.jsx'
      });
      expect(result.valid).toBe(true);
    });

    test('should reject empty path', () => {
      const result = validateToolParams('read_file', {
        repo: 'owner/repo',
        path: ''
      });
      expect(result.valid).toBe(false);
    });

    test('should accept branch parameter', () => {
      const result = validateToolParams('read_file', {
        repo: 'owner/repo',
        path: 'file.js',
        branch: 'develop'
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('get_tree schema', () => {
    test('should accept repo only', () => {
      const result = validateToolParams('get_tree', { repo: 'owner/repo' });
      expect(result.valid).toBe(true);
    });

    test('should accept with branch', () => {
      const result = validateToolParams('get_tree', {
        repo: 'owner/repo',
        branch: 'main'
      });
      expect(result.valid).toBe(true);
    });

    test('should accept with ref', () => {
      const result = validateToolParams('get_tree', {
        repo: 'owner/repo',
        ref: 'abc123'
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('get_commits schema', () => {
    test('should accept repo only', () => {
      const result = validateToolParams('get_commits', { repo: 'owner/repo' });
      expect(result.valid).toBe(true);
    });

    test('should accept with branch', () => {
      const result = validateToolParams('get_commits', {
        repo: 'owner/repo',
        branch: 'main'
      });
      expect(result.valid).toBe(true);
    });

    test('should accept valid SHA', () => {
      const result = validateToolParams('get_commits', {
        repo: 'owner/repo',
        sha: 'abc123f'
      });
      expect(result.valid).toBe(true);
    });

    test('should reject invalid SHA format', () => {
      const result = validateToolParams('get_commits', {
        repo: 'owner/repo',
        sha: 'xyz'
      });
      expect(result.valid).toBe(false);
    });

    test('should accept pagination params', () => {
      const result = validateToolParams('get_commits', {
        repo: 'owner/repo',
        page: 2,
        per_page: 50
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('get_branches schema', () => {
    test('should accept repo only', () => {
      const result = validateToolParams('get_branches', { repo: 'owner/repo' });
      expect(result.valid).toBe(true);
    });

    test('should accept pagination', () => {
      const result = validateToolParams('get_branches', {
        repo: 'owner/repo',
        page: 1,
        per_page: 100
      });
      expect(result.valid).toBe(true);
    });

    test('should reject page out of range', () => {
      const result = validateToolParams('get_branches', {
        repo: 'owner/repo',
        page: 101
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('list_pull_requests schema', () => {
    test('should accept repo only', () => {
      const result = validateToolParams('list_pull_requests', { repo: 'owner/repo' });
      expect(result.valid).toBe(true);
    });

    test('should accept valid state', () => {
      const result = validateToolParams('list_pull_requests', {
        repo: 'owner/repo',
        state: 'open'
      });
      expect(result.valid).toBe(true);
    });

    test('should accept closed state', () => {
      const result = validateToolParams('list_pull_requests', {
        repo: 'owner/repo',
        state: 'closed'
      });
      expect(result.valid).toBe(true);
    });

    test('should accept all state', () => {
      const result = validateToolParams('list_pull_requests', {
        repo: 'owner/repo',
        state: 'all'
      });
      expect(result.valid).toBe(true);
    });

    test('should reject invalid state', () => {
      const result = validateToolParams('list_pull_requests', {
        repo: 'owner/repo',
        state: 'invalid'
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('get_pr_mergeability schema', () => {
    test('should accept valid params', () => {
      const result = validateToolParams('get_pr_mergeability', {
        repo: 'owner/repo',
        prNumber: 123
      });
      expect(result.valid).toBe(true);
    });

    test('should reject missing prNumber', () => {
      const result = validateToolParams('get_pr_mergeability', { repo: 'owner/repo' });
      expect(result.valid).toBe(false);
    });

    test('should reject zero prNumber', () => {
      const result = validateToolParams('get_pr_mergeability', {
        repo: 'owner/repo',
        prNumber: 0
      });
      expect(result.valid).toBe(false);
    });

    test('should reject negative prNumber', () => {
      const result = validateToolParams('get_pr_mergeability', {
        repo: 'owner/repo',
        prNumber: -1
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('get_checks_for_sha schema', () => {
    test('should accept valid params', () => {
      const result = validateToolParams('get_checks_for_sha', {
        repo: 'owner/repo',
        sha: 'abc123def456'
      });
      expect(result.valid).toBe(true);
    });

    test('should accept 7-char SHA', () => {
      const result = validateToolParams('get_checks_for_sha', {
        repo: 'owner/repo',
        sha: 'abc123f'
      });
      expect(result.valid).toBe(true);
    });

    test('should accept 40-char SHA', () => {
      const result = validateToolParams('get_checks_for_sha', {
        repo: 'owner/repo',
        sha: 'a'.repeat(40)
      });
      expect(result.valid).toBe(true);
    });

    test('should reject invalid SHA', () => {
      const result = validateToolParams('get_checks_for_sha', {
        repo: 'owner/repo',
        sha: 'invalid'
      });
      expect(result.valid).toBe(false);
    });
  });

  // ============================================================================
  // WRITE TOOLS SCHEMAS
  // ============================================================================

  describe('create_pull_request schema', () => {
    test('should accept valid PR params', () => {
      const result = validateToolParams('create_pull_request', {
        repo: 'owner/repo',
        title: 'Test PR',
        head: 'feature-branch',
        base: 'main'
      });
      expect(result.valid).toBe(true);
    });

    test('should accept with body', () => {
      const result = validateToolParams('create_pull_request', {
        repo: 'owner/repo',
        title: 'Test PR',
        body: 'PR description',
        head: 'feature-branch',
        base: 'main'
      });
      expect(result.valid).toBe(true);
    });

    test('should accept draft flag', () => {
      const result = validateToolParams('create_pull_request', {
        repo: 'owner/repo',
        title: 'Test PR',
        head: 'feature-branch',
        base: 'main',
        draft: true
      });
      expect(result.valid).toBe(true);
    });

    test('should reject missing title', () => {
      const result = validateToolParams('create_pull_request', {
        repo: 'owner/repo',
        head: 'feature',
        base: 'main'
      });
      expect(result.valid).toBe(false);
    });

    test('should reject title too long', () => {
      const result = validateToolParams('create_pull_request', {
        repo: 'owner/repo',
        title: 'x'.repeat(300),
        head: 'feature',
        base: 'main'
      });
      expect(result.valid).toBe(false);
    });

    test('should reject body too long', () => {
      const result = validateToolParams('create_pull_request', {
        repo: 'owner/repo',
        title: 'Test',
        body: 'x'.repeat(15000),
        head: 'feature',
        base: 'main'
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('update_pull_request schema', () => {
    test('should accept valid update params', () => {
      const result = validateToolParams('update_pull_request', {
        repo: 'owner/repo',
        prNumber: 123,
        title: 'Updated title'
      });
      expect(result.valid).toBe(true);
    });

    test('should accept state change', () => {
      const result = validateToolParams('update_pull_request', {
        repo: 'owner/repo',
        prNumber: 123,
        state: 'closed'
      });
      expect(result.valid).toBe(true);
    });

    test('should reject invalid state', () => {
      const result = validateToolParams('update_pull_request', {
        repo: 'owner/repo',
        prNumber: 123,
        state: 'invalid'
      });
      expect(result.valid).toBe(false);
    });

    test('should accept draft flag', () => {
      const result = validateToolParams('update_pull_request', {
        repo: 'owner/repo',
        prNumber: 123,
        draft: false
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('merge_pull_request schema', () => {
    test('should accept valid merge params', () => {
      const result = validateToolParams('merge_pull_request', {
        repo: 'owner/repo',
        prNumber: 123
      });
      expect(result.valid).toBe(true);
    });

    test('should accept merge method', () => {
      const result = validateToolParams('merge_pull_request', {
        repo: 'owner/repo',
        prNumber: 123,
        merge_method: 'squash'
      });
      expect(result.valid).toBe(true);
    });

    test('should reject invalid merge method', () => {
      const result = validateToolParams('merge_pull_request', {
        repo: 'owner/repo',
        prNumber: 123,
        merge_method: 'invalid'
      });
      expect(result.valid).toBe(false);
    });

    test('should accept commit message', () => {
      const result = validateToolParams('merge_pull_request', {
        repo: 'owner/repo',
        prNumber: 123,
        commit_title: 'Merge title',
        commit_message: 'Merge message'
      });
      expect(result.valid).toBe(true);
    });

    test('should accept SHA for safety', () => {
      const result = validateToolParams('merge_pull_request', {
        repo: 'owner/repo',
        prNumber: 123,
        sha: 'abc123def456'
      });
      expect(result.valid).toBe(true);
    });

    test('should accept delete_branch flag', () => {
      const result = validateToolParams('merge_pull_request', {
        repo: 'owner/repo',
        prNumber: 123,
        delete_branch: true
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('commit_files schema', () => {
    test('should accept valid commit params', () => {
      const result = validateToolParams('commit_files', {
        repo: 'owner/repo',
        branch: 'main',
        message: 'Test commit',
        files: [
          { path: 'test.js', content: 'console.log("test");' }
        ]
      });
      expect(result.valid).toBe(true);
    });

    test('should accept multiple files', () => {
      const result = validateToolParams('commit_files', {
        repo: 'owner/repo',
        branch: 'main',
        message: 'Test commit',
        files: [
          { path: 'file1.js', content: 'content1' },
          { path: 'file2.js', content: 'content2' },
          { path: 'file3.js', content: 'content3' }
        ]
      });
      expect(result.valid).toBe(true);
    });

    test('should accept base64 encoding', () => {
      const result = validateToolParams('commit_files', {
        repo: 'owner/repo',
        branch: 'main',
        message: 'Test commit',
        files: [
          { path: 'image.png', content: 'base64data', encoding: 'base64' }
        ]
      });
      expect(result.valid).toBe(true);
    });

    test('should reject empty files array', () => {
      const result = validateToolParams('commit_files', {
        repo: 'owner/repo',
        branch: 'main',
        message: 'Test commit',
        files: []
      });
      expect(result.valid).toBe(false);
    });

    test('should reject too many files', () => {
      const files = Array(25).fill({ path: 'test.js', content: 'test' });
      const result = validateToolParams('commit_files', {
        repo: 'owner/repo',
        branch: 'main',
        message: 'Test commit',
        files
      });
      expect(result.valid).toBe(false);
    });

    test('should reject file without required fields', () => {
      const result = validateToolParams('commit_files', {
        repo: 'owner/repo',
        branch: 'main',
        message: 'Test commit',
        files: [{ path: 'test.js' }]
      });
      expect(result.valid).toBe(false);
    });

    test('should reject invalid encoding', () => {
      const result = validateToolParams('commit_files', {
        repo: 'owner/repo',
        branch: 'main',
        message: 'Test commit',
        files: [
          { path: 'test.js', content: 'test', encoding: 'invalid' }
        ]
      });
      expect(result.valid).toBe(false);
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge cases', () => {
    test('should handle very long valid strings at limit', () => {
      const result = validateToolParams('search', {
        query: 'x'.repeat(256)
      });
      expect(result.valid).toBe(true);
    });

    test('should reject strings just over limit', () => {
      const result = validateToolParams('search', {
        query: 'x'.repeat(257)
      });
      expect(result.valid).toBe(false);
    });

    test('should handle maximum pagination values', () => {
      const result = validateToolParams('search', {
        query: 'test',
        page: 100,
        per_page: 100
      });
      expect(result.valid).toBe(true);
    });

    test('should handle special characters in paths', () => {
      const result = validateToolParams('read_file', {
        repo: 'owner/repo',
        path: 'src/file-name_with.special@chars.js'
      });
      expect(result.valid).toBe(true);
    });

    test('should handle unicode in content', () => {
      const result = validateToolParams('commit_files', {
        repo: 'owner/repo',
        branch: 'main',
        message: 'Unicode test 你好',
        files: [
          { path: 'test.txt', content: 'Content with emoji 🚀' }
        ]
      });
      expect(result.valid).toBe(true);
    });
  });
});
