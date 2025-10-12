/**
 * Integration tests for error handling across all tools
 * Tests JSON-RPC error codes, GitHub API errors, validation errors
 */

const request = require('supertest');
const nock = require('nock');

describe('Error Handling Integration', () => {
  let app;
  const GITHUB_API = 'https://api.github.com';
  const MCP_WRITE_SECRET = 'test_secret_123';

  beforeAll(() => {
    // Set environment variables before requiring app
    process.env.MCP_WRITE_SECRET = MCP_WRITE_SECRET;
    process.env.GITHUB_PAT = 'ghp_test_token_1234567890';  // GitHub PAT format

    // Import app (will not start server due to require.main check)
    app = require('../../github-mcp-enhanced.js');
  });

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    delete process.env.MCP_WRITE_SECRET;
    delete process.env.GITHUB_PAT;
  });

  describe('JSON-RPC Error Codes', () => {
    test('should return -32602 for invalid params (schema validation)', async () => {
      const response = await request(app)
        .post(`/mcp/${MCP_WRITE_SECRET}`)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'search',
            arguments: {
              // Missing required 'query' parameter
              page: 1
            }
          }
        })
        .expect(200);

      expect(response.body.error.code).toBe(-32602);
      expect(response.body.error.message).toContain('required property');
      expect(response.body.error.data).toHaveProperty('tool', 'search');
      expect(response.body.error.data).toHaveProperty('validation_errors');
    });

    test('should return -32001 for permission denied (403)', async () => {
      nock(GITHUB_API)
        .get('/repos/private/repo')
        .reply(403, {
          message: 'Resource not accessible by integration'
        });

      const response = await request(app)
        .post(`/mcp/${MCP_WRITE_SECRET}`)
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'fetch',
            arguments: {
              repo: 'private/repo'
            }
          }
        })
        .expect(200);

      expect(response.body.error.code).toBe(-32001);
      expect(response.body.error.message).toContain('permission denied');
    });

    test('should return -32002 for not found (404)', async () => {
      nock(GITHUB_API)
        .get('/repos/nonexistent/repo')
        .reply(404, {
          message: 'Not Found'
        });

      const response = await request(app)
        .post(`/mcp/${MCP_WRITE_SECRET}`)
        .send({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'fetch',
            arguments: {
              repo: 'nonexistent/repo'
            }
          }
        })
        .expect(200);

      expect(response.body.error.code).toBe(-32002);
      expect(response.body.error.message).toContain('not found');
    });

    test('should return -32003 for validation error (422)', async () => {
      nock(GITHUB_API)
        .post('/repos/owner/repo/pulls')
        .reply(422, {
          message: 'Validation Failed',
          errors: [{ resource: 'PullRequest', field: 'base', code: 'invalid' }]
        });

      const response = await request(app)
        .post(`/mcp/${MCP_WRITE_SECRET}`)
        .send({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'create_pull_request',
            arguments: {
              repo: 'owner/repo',
              title: 'Test',
              head: 'feature',
              base: 'invalid-branch'
            }
          }
        })
        .expect(200);

      expect(response.body.error.code).toBe(-32003);
      expect(response.body.error.message).toContain('validation');
    });

    test('should return -32004 for rate limit exceeded', async () => {
      nock(GITHUB_API)
        .get('/search/repositories')
        .query(true)
        .reply(403, {
          message: 'API rate limit exceeded for user'
        });

      const response = await request(app)
        .post(`/mcp/${MCP_WRITE_SECRET}`)
        .send({
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: {
            name: 'search',
            arguments: {
              query: 'test'
            }
          }
        })
        .expect(200);

      expect(response.body.error.code).toBe(-32004);
      expect(response.body.error.message).toContain('rate limit');
    });

    test('should return -32005 for PR not mergeable', async () => {
      nock(GITHUB_API)
        .get('/repos/owner/repo/pulls/123')
        .reply(200, {
          number: 123,
          mergeable: false,
          mergeable_state: 'dirty',
          head: { sha: 'abc123' }
        });

      const response = await request(app)
        .post(`/mcp/${MCP_WRITE_SECRET}`)
        .send({
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: {
            name: 'merge_pull_request',
            arguments: {
              repo: 'owner/repo',
              prNumber: 123
            }
          }
        })
        .expect(200);

      expect(response.body.error.code).toBe(-32005);
      expect(response.body.error.message).toContain('not mergeable');
    });

    test('should return -32006 for SHA mismatch', async () => {
      nock(GITHUB_API)
        .get('/repos/owner/repo/pulls/456')
        .reply(200, {
          number: 456,
          mergeable: true,
          mergeable_state: 'clean',
          head: { sha: 'current_sha' }
        });

      const response = await request(app)
        .post(`/mcp/${MCP_WRITE_SECRET}`)
        .send({
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: {
            name: 'merge_pull_request',
            arguments: {
              repo: 'owner/repo',
              prNumber: 456,
              sha: 'old_sha' // Mismatch
            }
          }
        })
        .expect(200);

      expect(response.body.error.code).toBe(-32006);
      expect(response.body.error.message).toContain('SHA mismatch');
    });

    test('should return -32603 for internal error', async () => {
      nock(GITHUB_API)
        .get('/repos/owner/repo')
        .reply(500, {
          message: 'Internal Server Error'
        });

      const response = await request(app)
        .post(`/mcp/${MCP_WRITE_SECRET}`)
        .send({
          jsonrpc: '2.0',
          id: 8,
          method: 'tools/call',
          params: {
            name: 'fetch',
            arguments: {
              repo: 'owner/repo'
            }
          }
        })
        .expect(200);

      expect(response.body.error.code).toBe(-32603);
      expect(response.body.error.message).toContain('internal error');
    });
  });

  describe('Validation Error Format', () => {
    test('should include detailed validation errors in response', async () => {
      const response = await request(app)
        .post(`/mcp/${MCP_WRITE_SECRET}`)
        .send({
          jsonrpc: '2.0',
          id: 9,
          method: 'tools/call',
          params: {
            name: 'search',
            arguments: {
              query: 'a'.repeat(257), // Exceeds 256 char limit
              page: 101 // Exceeds max of 100
            }
          }
        })
        .expect(200);

      expect(response.body.error.code).toBe(-32602);
      expect(response.body.error.data.validation_errors).toBeInstanceOf(Array);
      expect(response.body.error.data.validation_errors.length).toBeGreaterThan(0);

      const error = response.body.error.data.validation_errors[0];
      expect(error).toHaveProperty('message');
      expect(error).toHaveProperty('path');
      expect(error).toHaveProperty('keyword');
    });
  });

  describe('Authentication Errors', () => {
    test('should reject write operations without auth token', async () => {
      const response = await request(app)
        .post(`/mcp/${MCP_WRITE_SECRET}`)
        // No Authorization header
        .send({
          jsonrpc: '2.0',
          id: 10,
          method: 'tools/call',
          params: {
            name: 'create_pull_request',
            arguments: {
              repo: 'owner/repo',
              title: 'Test',
              head: 'feature',
              base: 'main'
            }
          }
        })
        .expect(200);

      expect(response.body.error.code).toBe(-32001);
      expect(response.body.error.message).toContain('permission denied');
    });

    test('should reject write operations with invalid auth token', async () => {
      const response = await request(app)
        .post(`/mcp/${MCP_WRITE_SECRET}`)
        .set('Authorization', 'Bearer invalid_token_123')
        .send({
          jsonrpc: '2.0',
          id: 11,
          method: 'tools/call',
          params: {
            name: 'merge_pull_request',
            arguments: {
              repo: 'owner/repo',
              prNumber: 123
            }
          }
        })
        .expect(200);

      expect(response.body.error.code).toBe(-32001);
      expect(response.body.error.message).toContain('permission denied');
    });

    test('should allow read operations without auth token', async () => {
      nock(GITHUB_API)
        .get('/repos/owner/repo')
        .reply(200, {
          name: 'repo',
          full_name: 'owner/repo'
        });

      const response = await request(app)
        .post(`/mcp/${MCP_WRITE_SECRET}`)
        // No Authorization header - should still work for read
        .send({
          jsonrpc: '2.0',
          id: 12,
          method: 'tools/call',
          params: {
            name: 'fetch',
            arguments: {
              repo: 'owner/repo'
            }
          }
        })
        .expect(200);

      expect(response.body).toHaveProperty('result');
      expect(response.body.result).toHaveProperty('full_name', 'owner/repo');
    });
  });

  describe('Network and Retry Errors', () => {
    test('should handle network timeouts', async () => {
      nock(GITHUB_API)
        .get('/repos/owner/repo')
        .delayConnection(5000) // Simulate timeout
        .reply(200, {});

      const response = await request(app)
        .post(`/mcp/${MCP_WRITE_SECRET}`)
        .send({
          jsonrpc: '2.0',
          id: 13,
          method: 'tools/call',
          params: {
            name: 'fetch',
            arguments: {
              repo: 'owner/repo'
            }
          }
        })
        .expect(200);

      expect(response.body).toHaveProperty('error');
      expect([- 32603, -32004]).toContain(response.body.error.code);
    });

    test('should retry on 5xx errors', async () => {
      let attemptCount = 0;

      nock(GITHUB_API)
        .get('/repos/owner/repo')
        .times(2)
        .reply(() => {
          attemptCount++;
          if (attemptCount === 1) {
            return [502, { message: 'Bad Gateway' }];
          }
          return [200, { name: 'repo', full_name: 'owner/repo' }];
        });

      const response = await request(app)
        .post(`/mcp/${MCP_WRITE_SECRET}`)
        .send({
          jsonrpc: '2.0',
          id: 14,
          method: 'tools/call',
          params: {
            name: 'fetch',
            arguments: {
              repo: 'owner/repo'
            }
          }
        })
        .expect(200);

      // Should eventually succeed after retry
      expect(response.body).toHaveProperty('result');
      expect(attemptCount).toBeGreaterThan(1);
    });
  });
});
