/**
 * Integration test for PR duplicate detection with branch names containing slashes
 *
 * This test verifies the fix for the recurring 422 error when attempting to create
 * PRs with branch names containing slashes (e.g., feat/feature-name).
 *
 * Root cause: Manual query string building didn't URL-encode branch names,
 * causing the existing PR check to fail silently.
 *
 * Fix: Use parameter object for automatic URL encoding via githubRequest helper.
 */

const request = require('supertest');
const nock = require('nock');
const app = require('../../github-mcp-enhanced');

describe('PR Duplicate Detection with Slash in Branch Names', () => {
  const testRepo = 'test-owner/test-repo';
  const branchWithSlash = 'feat/mt3-integration-plan';
  const baseBranch = 'main';

  beforeEach(() => {
    // Set required environment variables
    process.env.GITHUB_PAT = 'test-token';
    process.env.PR_ENABLED = 'true';
    process.env.PR_WHITELIST = 'test-owner/*';
    process.env.MCP_AUTH_TOKEN = 'test-auth-token';
    process.env.MCP_WRITE_SECRET = 'test-write-secret';
  });

  afterEach(() => {
    nock.cleanAll();
  });

  test('should properly URL-encode branch names with slashes when checking for existing PRs', async () => {
    // Mock the existing PR check - should receive URL-encoded parameters
    const existingPRCheck = nock('https://api.github.com')
      .get('/repos/test-owner/test-repo/pulls')
      .query({
        head: 'test-owner:feat/mt3-integration-plan',
        base: 'main',
        state: 'open'
      })
      .reply(200, [{
        number: 123,
        title: 'Existing PR',
        html_url: 'https://github.com/test-owner/test-repo/pull/123',
        state: 'open',
        draft: false,
        created_at: '2025-01-01T00:00:00Z',
        head: { ref: branchWithSlash },
        base: { ref: baseBranch }
      }]);

    const response = await request(app)
      .post('/mcp/test-write-secret')
      .set('Authorization', 'Bearer test-auth-token')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_pull_request',
          arguments: {
            repo: testRepo,
            title: 'Test PR',
            body: 'Test description',
            head: branchWithSlash,
            base: baseBranch
          }
        }
      });

    expect(response.status).toBe(200);

    // Debug: log the response if test fails
    if (!response.body.result) {
      console.log('Response body:', JSON.stringify(response.body, null, 2));
    }

    expect(response.body.result).toBeDefined();

    const result = JSON.parse(response.body.result.content[0].text);
    expect(result.success).toBe(false);
    expect(result.exists).toBe(true);
    expect(result.pr.number).toBe(123);
    expect(result.message).toContain('already exists');

    // Verify the API was called with properly encoded parameters
    expect(existingPRCheck.isDone()).toBe(true);
  });

  test('should detect existing PR and prevent 422 error', async () => {
    // Mock the existing PR check
    nock('https://api.github.com')
      .get('/repos/test-owner/test-repo/pulls')
      .query({
        head: 'test-owner:feat/mt3-integration-plan',
        base: 'main',
        state: 'open'
      })
      .reply(200, [{
        number: 456,
        title: 'Existing PR',
        html_url: 'https://github.com/test-owner/test-repo/pull/456',
        state: 'open',
        draft: false,
        created_at: '2025-01-01T00:00:00Z'
      }]);

    const response = await request(app)
      .post('/mcp/test-write-secret')
      .set('Authorization', 'Bearer test-auth-token')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_pull_request',
          arguments: {
            repo: testRepo,
            title: 'Duplicate PR Attempt',
            body: 'This should be detected as duplicate',
            head: branchWithSlash,
            base: baseBranch
          }
        }
      });

    expect(response.status).toBe(200);

    const result = JSON.parse(response.body.result.content[0].text);
    expect(result.exists).toBe(true);
    expect(result.pr.number).toBe(456);

    // Verify NO POST request was made to create PR (prevented 422)
    expect(nock.pendingMocks()).toHaveLength(0);
  });

  test('should proceed with creation when no existing PR found', async () => {
    // Mock the existing PR check - returns empty array
    nock('https://api.github.com')
      .get('/repos/test-owner/test-repo/pulls')
      .query({
        head: 'test-owner:feat/mt3-integration-plan',
        base: 'main',
        state: 'open'
      })
      .reply(200, []);

    // Mock branch existence checks
    nock('https://api.github.com')
      .get('/repos/test-owner/test-repo/branches/main')
      .reply(200, { name: 'main', commit: { sha: 'abc123' } });

    nock('https://api.github.com')
      .get('/repos/test-owner/test-repo/branches/feat%2Fmt3-integration-plan')
      .reply(200, { name: branchWithSlash, commit: { sha: 'def456' } });

    // Mock PR creation
    nock('https://api.github.com')
      .post('/repos/test-owner/test-repo/pulls', {
        title: '[ChatGPT] New Feature',
        body: /This pull request was created by ChatGPT/,
        head: branchWithSlash,
        base: baseBranch,
        draft: false
      })
      .reply(201, {
        number: 789,
        html_url: 'https://github.com/test-owner/test-repo/pull/789',
        title: '[ChatGPT] New Feature',
        state: 'open',
        draft: false,
        created_at: '2025-01-02T00:00:00Z'
      });

    const response = await request(app)
      .post('/mcp/test-write-secret')
      .set('Authorization', 'Bearer test-auth-token')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_pull_request',
          arguments: {
            repo: testRepo,
            title: 'New Feature',
            body: 'New feature description',
            head: branchWithSlash,
            base: baseBranch
          }
        }
      });

    expect(response.status).toBe(200);

    const result = JSON.parse(response.body.result.content[0].text);
    expect(result.success).toBe(true);
    expect(result.pr.number).toBe(789);
  });

  test('should handle fatal errors (404) during PR check gracefully', async () => {
    // Mock the existing PR check - repository not found
    nock('https://api.github.com')
      .get('/repos/test-owner/test-repo/pulls')
      .query({
        head: 'test-owner:feat/mt3-integration-plan',
        base: 'main',
        state: 'open'
      })
      .reply(404, { message: 'Not Found' });

    const response = await request(app)
      .post('/mcp/test-write-secret')
      .set('Authorization', 'Bearer test-auth-token')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_pull_request',
          arguments: {
            repo: testRepo,
            title: 'Test PR',
            body: 'Test description',
            head: branchWithSlash,
            base: baseBranch
          }
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.error).toBeDefined();
    expect(response.body.error.message).toContain('not found or inaccessible');
  });

  test('should handle fatal errors (403) during PR check gracefully', async () => {
    // Mock the existing PR check - permission denied
    nock('https://api.github.com')
      .get('/repos/test-owner/test-repo/pulls')
      .query({
        head: 'test-owner:feat/mt3-integration-plan',
        base: 'main',
        state: 'open'
      })
      .reply(403, { message: 'Forbidden' });

    const response = await request(app)
      .post('/mcp/test-write-secret')
      .set('Authorization', 'Bearer test-auth-token')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_pull_request',
          arguments: {
            repo: testRepo,
            title: 'Test PR',
            body: 'Test description',
            head: branchWithSlash,
            base: baseBranch
          }
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.error).toBeDefined();
    expect(response.body.error.message).toContain('Permission denied');
    expect(response.body.error.message).toContain('pull_request:read');
  });
});
