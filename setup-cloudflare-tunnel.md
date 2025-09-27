# Setup Cloudflare Tunnel for Persistent URL (Free)

## Installation
```bash
brew install cloudflared
```

## Setup Steps

1. **Login to Cloudflare**:
```bash
cloudflared tunnel login
```

2. **Create a tunnel**:
```bash
cloudflared tunnel create github-mcp
```

3. **Create config file** at `~/.cloudflared/config.yml`:
```yaml
tunnel: github-mcp
credentials-file: /Users/bradleytangonan/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: github-mcp.yourdomain.com
    service: http://localhost:8788
  - service: http_status:404
```

4. **Route the tunnel** (if you have a domain):
```bash
cloudflared tunnel route dns github-mcp github-mcp.yourdomain.com
```

5. **Run the tunnel**:
```bash
cloudflared tunnel run github-mcp
```

## Without Custom Domain
You can also use Cloudflare's Quick Tunnels without a domain:
```bash
cloudflared tunnel --url http://localhost:8788
```

This gives you a URL like: `https://random-name-here.trycloudflare.com`

The URL changes on restart, but it's more stable than ngrok's free tier.

## Permanent Solution
For a truly permanent URL, use the full Cloudflare Tunnel setup with your own domain.