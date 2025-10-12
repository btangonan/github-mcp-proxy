/**
 * Integration tests for write tools (create_pull_request, merge_pull_request, commit_files)
 * Tests end-to-end flow with GitHub API mocking and rate limiting validation
 */

const request = require('supertest');
const nock = require('nock');

describe('Write Tools Integration', () => {
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
    delete process.env.GITHUB_TOKEN;
  });

  describe('create_pull_request tool', () => {
    test('should successfully create pull request', async () => {
      nock(GITHUB_API)
        .post('/repos/owner/repo/pulls', {
          title: 'Test PR',
          head: 'feature-branch',
          base: 'main',
          body: 'Test description',
          draft: false
        })
        .reply(201, {
          id: 789,
          number: 123,
          title: 'Test PR',
          html_url: 'https://github.com/owner/repo/pull/123',
          state: 'open',
          head: { ref: 'feature-branch' },
          base: { ref: 'main' },
          body: 'Test description',
          draft: false
        });

      const response = await request(app)
        .post(`/mcp/${MCP_WRITE_SECRET}`)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'create_pull_request',
            arguments: {
              repo: 'owner/repo',
              title: 'Test PR',
              head: 'feature-branch',
              base: 'main',
              body: 'Test description',
              draft: false
            }
          }
        })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.result).toHaveProperty('number', 123);
      expect(response.body.result).toHaveProperty('title', 'Test PR');
      expect(response.body.result).toHaveProperty('state', 'open');
    });

    test('should require write secret for create_pull_request', async () => {
      const response = await request(app)
        .post(`/mcp/${MCP_WRITE_SECRET}`)
        // No Authorization header
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'create_pull_request',
            arguments: {
              repo: 'owner/repo',
              title: 'Test PR',
              head: 'feature-branch',
              base: 'main'
            }
          }
        })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.error).toHaveProperty('code', -32001);
      expect(response.body.error.message).toContain('permission denied');
    });

    test('should validate PR title length', async () => {
      const longTitle = 'a'.repeat(257); // Exceeds 256 char limit

      const response = await request(app)
        .post(`/mcp/${MCP_WRITE_SECRET}`)
        .send({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'create_pull_request',
            arguments: {
              repo: 'owner/repo',
              title: longTitle,
              head: 'feature-branch',
              base: 'main'
            }
          }
        })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.error).toHaveProperty('code', -32602);
      expect(response.body.error.message).toContain('256');
    });

    test('should handle GitHub API validation errors', async () => {
      nock(GITHUB_API)
        .post('/repos/owner/repo/pulls')
        .reply(422, {
          message: 'Validation Failed',
          errors: [
            {
              resource: 'PullRequest',
              field: 'head',
              code: 'invalid'
            }
          ]
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
              title: 'Test PR',
              head: 'nonexistent-branch',
              base: 'main'
            }
          }
        })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.error).toHaveProperty('code', -32003);
      expect(response.body.error.message).toContain('validation');
    });
  });

  describe('merge_pull_request tool', () => {
    test('should successfully merge pull request', async () => {
      // Mock mergeability check
      nock(GITHUB_API)
        .get('/repos/owner/repo/pulls/123')
        .reply(200, {
          number: 123,
          mergeable: true,
          mergeable_state: 'clean',
          head: { sha: 'abc123def456' }
        });

      // Mock merge operation
      nock(GITHUB_API)
        .put('/repos/owner/repo/pulls/123/merge', {
          merge_method: 'squash',
          sha: 'abc123def456'
        })
        .reply(200, {
          sha: 'merged_sha_789',
          merged: true,
          message: 'Pull Request successfully merged'
        });

      const response = await request(app)
        .post(`/mcp/${MCP_WRITE_SECRET}`)
        .send({
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: {
            name: 'merge_pull_request',
            arguments: {
              repo: 'owner/repo',
              prNumber: 123,
              merge_method: 'squash',
              sha: 'abc123def456'
            }
          }
        })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.result).toHaveProperty('merged', true);
      expect(response.body.result).toHaveProperty('sha', 'merged_sha_789');
    });

    test('should reject merge when PR not mergeable', async () => {
      nock(GITHUB_API)
        .get('/repos/owner/repo/pulls/124')
        .reply(200, {
          number: 124,
          mergeable: false,
          mergeable_state: 'dirty',
          head: { sha: 'def456ghi789' }
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
              prNumber: 124,
              merge_method: 'merge'
            }
          }
        })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.error).toHaveProperty('code', -32005);
      expect(response.body.error.message).toContain('not mergeable');
    });

    test('should reject merge with SHA mismatch', async () => {
      nock(GITHUB_API)
        .get('/repos/owner/repo/pulls/125')
        .reply(200, {
          number: 125,
          mergeable: true,
          mergeable_state: 'clean',
          head: { sha: 'current_sha_123' }
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
              prNumber: 125,
              merge_method: 'merge',
              sha: 'old_sha_456' // Mismatch
            }
          }
        })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.error).toHaveProperty('code', -32006);
      expect(response.body.error.message).toContain('SHA mismatch');
    });

    test('should validate merge method enum', async () => {
      const response = await request(app)
        .post(`/mcp/${MCP_WRITE_SECRET}`)
        .send({
          jsonrpc: '2.0',
          id: 8,
          method: 'tools/call',
          params: {
            name: 'merge_pull_request',
            arguments: {
              repo: 'owner/repo',
              prNumber: 126,
              merge_method: 'invalid_method' // Invalid enum value
            }
          }
        })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.error).toHaveProperty('code', -32602);
      expect(response.body.error.message).toContain('allowed values');
    });
  });

  describe('commit_files tool', () => {
    test('should successfully commit multiple files', async () => {
      // Mock get latest commit SHA
      nock(GITHUB_API)
        .get('/repos/owner/repo/git/refs/heads/main')
        .reply(200, {
          ref: 'refs/heads/main',
          object: { sha: 'base_commit_sha' }
        });

      // Mock create tree
      nock(GITHUB_API)
        .post('/repos/owner/repo/git/trees', {
          base_tree: 'base_commit_sha',
          tree: [
            {
              path: 'src/file1.js',
              mode: '100644',
              type: 'blob',
              content: 'console.log("file1");'
            },
            {
              path: 'src/file2.js',
              mode: '100644',
              type: 'blob',
              content: 'console.log("file2");'
            }
          ]
        })
        .reply(201, {
          sha: 'new_tree_sha'
        });

      // Mock create commit
      nock(GITHUB_API)
        .post('/repos/owner/repo/git/commits', {
          message: 'Add new files',
          tree: 'new_tree_sha',
          parents: ['base_commit_sha']
        })
        .reply(201, {
          sha: 'new_commit_sha'
        });

      // Mock update reference
      nock(GITHUB_API)
        .patch('/repos/owner/repo/git/refs/heads/main', {
          sha: 'new_commit_sha',
          force: false
        })
        .reply(200, {
          ref: 'refs/heads/main',
          object: { sha: 'new_commit_sha' }
        });

      const response = await request(app)
        .post(`/mcp/${MCP_WRITE_SECRET}`)
        .send({
          jsonrpc: '2.0',
          id: 9,
          method: 'tools/call',
          params: {
            name: 'commit_files',
            arguments: {
              repo: 'owner/repo',
              branch: 'main',
              message: 'Add new files',
              files: [
                {
                  path: 'src/file1.js',
                  content: 'console.log("file1");',
                  encoding: 'utf8'
                },
                {
                  path: 'src/file2.js',
                  content: 'console.log("file2");',
                  encoding: 'utf8'
                }
              ]
            }
          }
        })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.result).toHaveProperty('commit_sha', 'new_commit_sha');
      expect(response.body.result).toHaveProperty('files_committed', 2);
    });

    test('should validate file count limits (1-20)', async () => {
      const tooManyFiles = Array.from({ length: 21 }, (_, i) => ({
        path: `file${i}.js`,
        content: 'test'
      }));

      const response = await request(app)
        .post(`/mcp/${MCP_WRITE_SECRET}`)
        .send({
          jsonrpc: '2.0',
          id: 10,
          method: 'tools/call',
          params: {
            name: 'commit_files',
            arguments: {
              repo: 'owner/repo',
              branch: 'main',
              message: 'Too many files',
              files: tooManyFiles
            }
          }
        })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.error).toHaveProperty('code', -32602);
      expect(response.body.error.message).toContain('20');
    });
  });

  describe('Rate Limiting', () => {
    test('should enforce rate limits for PR creation', async () => {
      // Attempt to create 6 PRs rapidly (limit is 5/min)
      const requests = [];

      for (let i = 0; i < 6; i++) {
        nock(GITHUB_API)
          .post('/repos/owner/repo/pulls')
          .reply(201, {
            number: 100 + i,
            title: `PR ${i}`
          });

        requests.push(
          request(app)
            .post(`/mcp/${MCP_WRITE_SECRET}`)
            .send({
              jsonrpc: '2.0',
              id: 20 + i,
              method: 'tools/call',
              params: {
                name: 'create_pull_request',
                arguments: {
                  repo: 'owner/repo',
                  title: `PR ${i}`,
                  head: `feature-${i}`,
                  base: 'main'
                }
              }
            })
        );
      }

      const responses = await Promise.all(requests);

      // First 5 should succeed
      responses.slice(0, 5).forEach(res => {
        expect(res.body).toHaveProperty('result');
      });

      // 6th should be rate limited
      expect(responses[5].body.error).toHaveProperty('code', -32004);
      expect(responses[5].body.error.message).toContain('rate limit');
    });
  });
});
