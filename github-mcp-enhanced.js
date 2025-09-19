require("dotenv").config();

const express = require("express");
const axios = require("axios");

const app = express();
const GITHUB_TOKEN = process.env.GITHUB_PAT;

if (!GITHUB_TOKEN) {
  console.error("❌ Please set GITHUB_PAT environment variable.");
  process.exit(1);
}

// Enable CORS for ChatGPT
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "*");
  res.header("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Parse JSON bodies
app.use(express.json());

// GitHub API client
const github = axios.create({
  baseURL: "https://api.github.com",
  headers: {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github.v3+json"
  }
});

// MCP endpoint
app.post("/mcp", async (req, res) => {
  console.log("📨 MCP Request:", JSON.stringify(req.body, null, 2));

  try {
    const { jsonrpc, method, params, id } = req.body;

    // Handle initialize method
    if (method === "initialize") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: {
            tools: {},
            resources: {}
          },
          serverInfo: {
            name: "github-mcp-enhanced",
            version: "2.0.0"
          }
        }
      });
    }

    // Handle initialized notification
    if (method === "notifications/initialized") {
      // Just acknowledge the notification
      return res.json({
        jsonrpc: "2.0",
        result: "ok"
      });
    }

    // List all available tools
    if (method === "tools/list") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "search",
              description: "Search GitHub repositories",
              inputSchema: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "Search query for GitHub"
                  }
                },
                required: ["query"]
              }
            },
            {
              name: "fetch",
              description: "Fetch repository metadata and README",
              inputSchema: {
                type: "object",
                properties: {
                  id: {
                    type: "string",
                    description: "Repository name (owner/repo)"
                  }
                },
                required: ["id"]
              }
            },
            {
              name: "list_directory",
              description: "List contents of a directory in a repository",
              inputSchema: {
                type: "object",
                properties: {
                  repo: {
                    type: "string",
                    description: "Repository (owner/repo)"
                  },
                  path: {
                    type: "string",
                    description: "Directory path (e.g., 'src/components')"
                  },
                  branch: {
                    type: "string",
                    description: "Branch name (default: main/master)"
                  }
                },
                required: ["repo"]
              }
            },
            {
              name: "read_file",
              description: "Read contents of a specific file",
              inputSchema: {
                type: "object",
                properties: {
                  repo: {
                    type: "string",
                    description: "Repository (owner/repo)"
                  },
                  path: {
                    type: "string",
                    description: "File path (e.g., 'src/index.js')"
                  },
                  branch: {
                    type: "string",
                    description: "Branch name (default: main/master)"
                  }
                },
                required: ["repo", "path"]
              }
            },
            {
              name: "get_tree",
              description: "Get the full repository tree structure",
              inputSchema: {
                type: "object",
                properties: {
                  repo: {
                    type: "string",
                    description: "Repository (owner/repo)"
                  },
                  branch: {
                    type: "string",
                    description: "Branch name (default: main/master)"
                  }
                },
                required: ["repo"]
              }
            },
            {
              name: "get_commits",
              description: "Get recent commits for a repository",
              inputSchema: {
                type: "object",
                properties: {
                  repo: {
                    type: "string",
                    description: "Repository (owner/repo)"
                  },
                  path: {
                    type: "string",
                    description: "Optional path to filter commits"
                  },
                  limit: {
                    type: "number",
                    description: "Number of commits to return (default: 10)"
                  }
                },
                required: ["repo"]
              }
            },
            {
              name: "get_branches",
              description: "List all branches in a repository",
              inputSchema: {
                type: "object",
                properties: {
                  repo: {
                    type: "string",
                    description: "Repository (owner/repo)"
                  }
                },
                required: ["repo"]
              }
            }
          ]
        }
      });
    }

    // Handle tool calls
    if (method === "tools/call") {
      const { name, arguments: args } = params;

      // SEARCH tool - search repositories
      if (name === "search") {
        const query = args.query;
        const repoResponse = await github.get("/search/repositories", {
          params: {
            q: query,
            per_page: 5,
            sort: "stars"
          }
        });

        const results = repoResponse.data.items.map(repo => ({
          id: repo.full_name,
          title: `${repo.full_name} - ${repo.description || "No description"}`,
          url: repo.html_url
        }));

        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({ results })
              }
            ]
          }
        });
      }

      // FETCH tool - get repo metadata
      if (name === "fetch") {
        const [owner, repo] = args.id.split("/");

        const repoResponse = await github.get(`/repos/${owner}/${repo}`);
        const readmeResponse = await github.get(`/repos/${owner}/${repo}/readme`, {
          headers: {
            Accept: "application/vnd.github.raw"
          }
        }).catch(() => ({ data: "No README available" }));

        const document = {
          id: repoResponse.data.full_name,
          title: repoResponse.data.name,
          text: `# ${repoResponse.data.name}\n\n${repoResponse.data.description || ""}\n\n` +
                `Stars: ${repoResponse.data.stargazers_count}\n` +
                `Language: ${repoResponse.data.language || "Unknown"}\n` +
                `Created: ${repoResponse.data.created_at}\n\n` +
                `## README\n\n${readmeResponse.data}`,
          url: repoResponse.data.html_url,
          metadata: {
            stars: repoResponse.data.stargazers_count,
            language: repoResponse.data.language,
            owner: repoResponse.data.owner.login
          }
        };

        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(document)
              }
            ]
          }
        });
      }

      // LIST_DIRECTORY tool - browse folder contents
      if (name === "list_directory") {
        const [owner, repo] = args.repo.split("/");
        const path = args.path || "";
        const branch = args.branch || "main";

        try {
          const response = await github.get(`/repos/${owner}/${repo}/contents/${path}`, {
            params: { ref: branch }
          });

          const contents = Array.isArray(response.data) ? response.data : [response.data];
          const items = contents.map(item => ({
            name: item.name,
            type: item.type,
            path: item.path,
            size: item.size,
            url: item.html_url
          }));

          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    path: path || "/",
                    items: items
                  })
                }
              ]
            }
          });
        } catch (error) {
          // Try with master branch if main fails
          if (branch === "main") {
            const response = await github.get(`/repos/${owner}/${repo}/contents/${path}`, {
              params: { ref: "master" }
            });
            const contents = Array.isArray(response.data) ? response.data : [response.data];
            const items = contents.map(item => ({
              name: item.name,
              type: item.type,
              path: item.path,
              size: item.size,
              url: item.html_url
            }));

            return res.json({
              jsonrpc: "2.0",
              id,
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      path: path || "/",
                      items: items
                    })
                  }
                ]
              }
            });
          }
          throw error;
        }
      }

      // READ_FILE tool - get file contents
      if (name === "read_file") {
        const [owner, repo] = args.repo.split("/");
        const path = args.path;
        const branch = args.branch || "main";

        try {
          const response = await github.get(`/repos/${owner}/${repo}/contents/${path}`, {
            params: { ref: branch },
            headers: {
              Accept: "application/vnd.github.raw"
            }
          });

          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    path: path,
                    content: response.data,
                    url: `https://github.com/${owner}/${repo}/blob/${branch}/${path}`
                  })
                }
              ]
            }
          });
        } catch (error) {
          // Try with master branch if main fails
          if (branch === "main") {
            const response = await github.get(`/repos/${owner}/${repo}/contents/${path}`, {
              params: { ref: "master" },
              headers: {
                Accept: "application/vnd.github.raw"
              }
            });

            return res.json({
              jsonrpc: "2.0",
              id,
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      path: path,
                      content: response.data,
                      url: `https://github.com/${owner}/${repo}/blob/master/${path}`
                    })
                  }
                ]
              }
            });
          }
          throw error;
        }
      }

      // GET_TREE tool - full repository structure
      if (name === "get_tree") {
        const [owner, repo] = args.repo.split("/");
        const branch = args.branch || "main";

        try {
          // Get the branch to find the tree SHA
          const branchResponse = await github.get(`/repos/${owner}/${repo}/branches/${branch}`);
          const treeSha = branchResponse.data.commit.commit.tree.sha;

          // Get the tree recursively
          const treeResponse = await github.get(`/repos/${owner}/${repo}/git/trees/${treeSha}`, {
            params: { recursive: 1 }
          });

          const tree = treeResponse.data.tree.map(item => ({
            path: item.path,
            type: item.type,
            size: item.size
          }));

          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    branch: branch,
                    tree: tree
                  })
                }
              ]
            }
          });
        } catch (error) {
          // Try with master branch if main fails
          if (branch === "main") {
            const branchResponse = await github.get(`/repos/${owner}/${repo}/branches/master`);
            const treeSha = branchResponse.data.commit.commit.tree.sha;
            const treeResponse = await github.get(`/repos/${owner}/${repo}/git/trees/${treeSha}`, {
              params: { recursive: 1 }
            });

            const tree = treeResponse.data.tree.map(item => ({
              path: item.path,
              type: item.type,
              size: item.size
            }));

            return res.json({
              jsonrpc: "2.0",
              id,
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      branch: "master",
                      tree: tree
                    })
                  }
                ]
              }
            });
          }
          throw error;
        }
      }

      // GET_COMMITS tool - recent commit history
      if (name === "get_commits") {
        const [owner, repo] = args.repo.split("/");
        const path = args.path;
        const limit = args.limit || 10;

        const params = { per_page: limit };
        if (path) params.path = path;

        const response = await github.get(`/repos/${owner}/${repo}/commits`, { params });

        const commits = response.data.map(commit => ({
          sha: commit.sha.substring(0, 7),
          message: commit.commit.message.split('\n')[0],
          author: commit.commit.author.name,
          date: commit.commit.author.date,
          url: commit.html_url
        }));

        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  commits: commits
                })
              }
            ]
          }
        });
      }

      // GET_BRANCHES tool - list all branches
      if (name === "get_branches") {
        const [owner, repo] = args.repo.split("/");

        const response = await github.get(`/repos/${owner}/${repo}/branches`, {
          params: { per_page: 100 }
        });

        const branches = response.data.map(branch => ({
          name: branch.name,
          protected: branch.protected
        }));

        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  branches: branches,
                  default: branches.find(b => b.name === "main" || b.name === "master")?.name || branches[0]?.name
                })
              }
            ]
          }
        });
      }

      // Unknown tool
      return res.json({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Unknown tool: ${name}`
        }
      });
    }

    // Unknown method
    return res.json({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`
      }
    });

  } catch (error) {
    console.error("❌ Error:", error.message);
    res.json({
      jsonrpc: "2.0",
      id: req.body.id,
      error: {
        code: -32603,
        message: error.message
      }
    });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "GitHub MCP Enhanced v2.0" });
});

// SSE endpoint for ChatGPT
app.get("/sse", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });

  res.write('event: open\n');
  res.write('data: {"type":"open"}\n\n');

  const interval = setInterval(() => {
    res.write("event: ping\ndata: {}\n\n");
  }, 30000);

  req.on("close", () => {
    clearInterval(interval);
  });
});

// SSE endpoint for MCP messages - handle directly
app.post("/sse", async (req, res) => {
  console.log("📨 SSE MCP Request:", JSON.stringify(req.body, null, 2));

  try {
    const { jsonrpc, method, params, id } = req.body;

    // Handle initialize method
    if (method === "initialize") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: {
            tools: {},
            resources: {}
          },
          serverInfo: {
            name: "github-mcp-enhanced",
            version: "2.0.0"
          }
        }
      });
    }

    // Handle initialized notification
    if (method === "notifications/initialized") {
      return res.json({
        jsonrpc: "2.0",
        result: "ok"
      });
    }

    // Forward other requests to the main handler
    req.url = "/mcp";
    app.handle(req, res);
  } catch (error) {
    console.error("❌ SSE Error:", error.message);
    res.json({
      jsonrpc: "2.0",
      id: req.body?.id || 1,
      error: {
        code: -32603,
        message: error.message
      }
    });
  }
});

const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log("═══════════════════════════════════════════");
  console.log("✅ GitHub MCP Enhanced v2.0 Running");
  console.log(`📍 URL: http://localhost:${port}/mcp`);
  console.log(`📍 SSE: http://localhost:${port}/sse`);
  console.log("═══════════════════════════════════════════");
  console.log("");
  console.log("🚀 Enhanced Tools Available:");
  console.log("  • search - Search repositories");
  console.log("  • fetch - Get repo metadata");
  console.log("  • list_directory - Browse folders");
  console.log("  • read_file - Read file contents");
  console.log("  • get_tree - Full repo structure");
  console.log("  • get_commits - Commit history");
  console.log("  • get_branches - List branches");
  console.log("");
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${port} is already in use. Please close the other process or use a different port.`);
    process.exit(1);
  } else {
    console.error('❌ Server error:', err);
  }
});

// Add global error handlers
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  // Don't exit - try to recover
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - try to recover
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('⚠️ SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n⚠️ SIGINT received, shutting down gracefully...');
  process.exit(0);
});