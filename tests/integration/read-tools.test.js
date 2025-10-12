/**
 * Integration tests for read tools (search, fetch, list_directory, read_file)
 * Tests end-to-end flow: HTTP request → JSON-RPC → validation → tool execution → GitHub API → response
 */

const request = require('supertest');
const nock = require('nock');

describe('Read Tools Integration', () => {
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
    // Clean all HTTP mocks before each test
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    // Clean up
    delete process.env.MCP_WRITE_SECRET;
    delete process.env.GITHUB_TOKEN;
  });

  describe('search tool', () => {
    test('should successfully search repositories', async () => {
      // Mock GitHub API search response
      nock(GITHUB_API)
        .get('/search/repositories')
        .query({ q: 'test', page: 1, per_page: 10 })
        .reply(200, {
          total_count: 1,
          items: [
            {
              id: 123,
              name: 'test-repo',
              full_name: 'owner/test-repo',
              description: 'Test repository',
              html_url: 'https://github.com/owner/test-repo',
              stargazers_count: 100,
              language: 'JavaScript'
            }
          ]
        });

      // Make request through app
      const response = await request(app)
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'search',
            arguments: {
              query: 'test',
              page: 1,
              per_page: 10
            }
          }
        })
        .expect('Content-Type', /json/)
        .expect(200);

      // Verify response structure
      expect(response.body).toHaveProperty('jsonrpc', '2.0');
      expect(response.body).toHaveProperty('id', 1);
      expect(response.body).toHaveProperty('result');

      // Verify result content
      const result = response.body.result;
      expect(result).toHaveProperty('total_count', 1);
      expect(result).toHaveProperty('items');
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toHaveProperty('full_name', 'owner/test-repo');
    });

    test('should handle schema validation errors', async () => {
      const response = await request(app)
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'search',
            arguments: {} // Missing required 'query' parameter
          }
        })
        .expect('Content-Type', /json/)
        .expect(200);

      // Verify error response
      expect(response.body).toHaveProperty('jsonrpc', '2.0');
      expect(response.body).toHaveProperty('id', 2);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('code', -32602);
      expect(response.body.error.message).toContain('required property');
      expect(response.body.error.data).toHaveProperty('tool', 'search');
    });

    test('should handle GitHub API 404 errors', async () => {
      nock(GITHUB_API)
        .get('/search/repositories')
        .query({ q: 'nonexistent', page: 1, per_page: 10 })
        .reply(404, {
          message: 'Not Found'
        });

      const response = await request(app)
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'search',
            arguments: {
              query: 'nonexistent',
              page: 1,
              per_page: 10
            }
          }
        })
        .expect('Content-Type', /json/)
        .expect(200);

      // Verify error response
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('code', -32002);
      expect(response.body.error.message).toContain('not found');
    });

    test('should handle GitHub API rate limiting', async () => {
      nock(GITHUB_API)
        .get('/search/repositories')
        .query({ q: 'rate-limited', page: 1, per_page: 10 })
        .reply(403, {
          message: 'API rate limit exceeded'
        });

      const response = await request(app)
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'search',
            arguments: {
              query: 'rate-limited',
              page: 1,
              per_page: 10
            }
          }
        })
        .expect('Content-Type', /json/)
        .expect(200);

      // Verify error response
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('code', -32004);
      expect(response.body.error.message).toContain('rate limit');
    });
  });

  describe('fetch tool', () => {
    test('should successfully fetch repository info', async () => {
      nock(GITHUB_API)
        .get('/repos/owner/repo')
        .reply(200, {
          id: 456,
          name: 'repo',
          full_name: 'owner/repo',
          description: 'Test repository',
          html_url: 'https://github.com/owner/repo',
          default_branch: 'main',
          stargazers_count: 50,
          language: 'TypeScript'
        });

      const response = await request(app)
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: {
            name: 'fetch',
            arguments: {
              repo: 'owner/repo'
            }
          }
        })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.result).toHaveProperty('full_name', 'owner/repo');
      expect(response.body.result).toHaveProperty('default_branch', 'main');
    });

    test('should validate repo format', async () => {
      const response = await request(app)
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: {
            name: 'fetch',
            arguments: {
              repo: 'invalid-format' // Missing owner/repo format
            }
          }
        })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.error).toHaveProperty('code', -32602);
      expect(response.body.error.message).toContain('pattern');
    });
  });

  describe('list_directory tool', () => {
    test('should successfully list directory contents', async () => {
      nock(GITHUB_API)
        .get('/repos/owner/repo/contents/src')
        .query({ ref: 'main' })
        .reply(200, [
          {
            name: 'index.js',
            path: 'src/index.js',
            type: 'file',
            size: 1234,
            sha: 'abc123'
          },
          {
            name: 'utils',
            path: 'src/utils',
            type: 'dir',
            size: 0,
            sha: 'def456'
          }
        ]);

      const response = await request(app)
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: {
            name: 'list_directory',
            arguments: {
              repo: 'owner/repo',
              path: 'src',
              branch: 'main'
            }
          }
        })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.result).toHaveLength(2);
      expect(response.body.result[0]).toHaveProperty('name', 'index.js');
      expect(response.body.result[0]).toHaveProperty('type', 'file');
    });
  });

  describe('read_file tool', () => {
    test('should successfully read file contents', async () => {
      const fileContent = Buffer.from('console.log("Hello World");').toString('base64');

      nock(GITHUB_API)
        .get('/repos/owner/repo/contents/src/index.js')
        .query({ ref: 'main' })
        .reply(200, {
          name: 'index.js',
          path: 'src/index.js',
          type: 'file',
          encoding: 'base64',
          content: fileContent,
          size: 27,
          sha: 'abc123'
        });

      const response = await request(app)
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 8,
          method: 'tools/call',
          params: {
            name: 'read_file',
            arguments: {
              repo: 'owner/repo',
              path: 'src/index.js',
              branch: 'main'
            }
          }
        })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.result).toHaveProperty('content');
      expect(response.body.result).toHaveProperty('path', 'src/index.js');
      expect(response.body.result).toHaveProperty('encoding', 'base64');
    });
  });
});
