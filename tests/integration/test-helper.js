/**
 * Integration test helper
 * Manages server lifecycle for integration tests
 */

const { spawn } = require('child_process');
const axios = require('axios');

class TestServer {
  constructor(port = 8789) {
    this.port = port;
    this.process = null;
    this.baseUrl = `http://localhost:${port}`;
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.process = spawn('node', ['github-mcp-enhanced.js'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PORT: this.port.toString(),
          MCP_WRITE_SECRET: 'test_secret_123',
          GITHUB_TOKEN: 'test_github_token'
        }
      });

      let output = '';

      this.process.stdout.on('data', (data) => {
        output += data.toString();
        if (output.includes('GitHub MCP Enhanced')) {
          // Server started successfully
          setTimeout(() => resolve(), 500); // Give it a moment to fully initialize
        }
      });

      this.process.stderr.on('data', (data) => {
        console.error(`Server stderr: ${data}`);
      });

      this.process.on('error', (error) => {
        reject(new Error(`Failed to start server: ${error.message}`));
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.process && !output.includes('GitHub MCP Enhanced')) {
          this.stop();
          reject(new Error('Server failed to start within 10 seconds'));
        }
      }, 10000);
    });
  }

  async stop() {
    if (this.process) {
      this.process.kill('SIGTERM');

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          // Force kill if doesn't stop gracefully
          if (this.process) {
            this.process.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        this.process.on('exit', () => {
          clearTimeout(timeout);
          this.process = null;
          resolve();
        });
      });
    }
  }

  async waitForReady(maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await axios.post(`${this.baseUrl}/mcp`, {
          jsonrpc: '2.0',
          id: 'health-check',
          method: 'tools/list'
        }, {
          timeout: 1000
        });

        if (response.status === 200) {
          return true;
        }
      } catch (error) {
        // Server not ready yet, wait and retry
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    return false;
  }
}

module.exports = { TestServer };
