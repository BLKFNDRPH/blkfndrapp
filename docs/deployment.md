# Deployment

## Prerequisites

1. **Portainer installed** on your server (Community or Business Edition)
2. **Docker** and **Docker Compose** installed
3. **Environment variables** configured

## Quick Start

### 1. Prepare Environment Variables

For Portainer deployment, you'll need to copy your environment variables. Your credentials are already prepared in `portainer-env.txt`.

**Option A: Copy all variables at once**
```bash
# View the variables to copy
cat portainer-env.txt
```

**Option B: Load from .env.local for local Docker deployment**
When deploying locally (not via Portainer), create a `.env` file:
```bash
cp .env.local .env
# Edit NODE_ENV if needed
```

### 2. Deploy via Portainer UI

**IMPORTANT**: Portainer needs environment variables at BOTH build-time and runtime. When you add variables in Portainer's UI, they will be automatically available for both the Docker build process and the running container.

#### Option A: Using Portainer Stacks with Web Editor (Recommended)

1. Log into your Portainer instance
2. Navigate to **Stacks** → **Add Stack**
3. **Name** your stack (e.g., `blkfndr`)
4. Choose **Web editor** build method
5. Copy and paste the contents of `docker-compose.yml`
6. **Add environment variables** (CRITICAL STEP):
   - Scroll down and click **Advanced mode**
   - Copy the contents of `portainer-env.txt`
   - Paste into the **Environment variables** text area
   - These variables will be used during both build and runtime
7. Click **Deploy the stack**
8. Wait for the build to complete (first build takes 5-10 minutes)

#### Option B: Using Portainer Git Repository

1. Navigate to **Stacks** → **Add Stack**
2. Choose **Repository** build method
3. Enter your Git repository URL
4. Specify `docker-compose.yml` as the Compose path
5. **Add environment variables**:
   - Click **Advanced mode**
   - Copy contents from `portainer-env.txt` and paste into **Environment variables**
6. Click **Deploy the stack**

### 3. Deploy via Command Line

If you prefer CLI deployment:

**First, create `.env` file from your local environment:**
```bash
cp .env.local .env
```

**Then deploy:**
```bash
# Build the image
docker compose build

# Start the stack
docker compose up -d

# Check logs
docker compose logs -f blkfndr-app
```

**Note**: Docker Compose automatically loads `.env` file from the current directory.

## Port Configuration

The application runs on **port 9002** by default (mapped from container port 3000).

To change the host port, edit `docker-compose.yml`:

```yaml
ports:
  - "YOUR_PORT:3000"  # Change YOUR_PORT to desired port
```

## Understanding the Build Process

Next.js requires `NEXT_PUBLIC_*` environment variables at **build time** (not just runtime). This is why:

1. **Dockerfile** accepts these variables as `ARG` (build arguments)
2. **docker-compose.yml** passes them in the `build: args:` section
3. **Portainer** automatically provides environment variables to both build and runtime

The build process:
- Takes 5-10 minutes on first build (downloads dependencies, compiles TypeScript, bundles JS)
- Subsequent rebuilds are faster (cached layers)
- Variables are "baked" into the JavaScript bundle at build time
- Server-side variables (like `GOOGLE_GENERATIVEAI_API_KEY`) are only available at runtime

## Health Checks

The container includes a health check that monitors the application status. View health status in Portainer:

1. Go to **Containers**
2. Click on `blkfndr-app`
3. Check the **Health** indicator

## Updating the Application

### Via Portainer UI

1. Navigate to **Stacks**
2. Select `blkfndr`
3. Click **Update the stack**
4. Pull and redeploy: Toggle **Re-pull image** and **Re-deploy**
5. Click **Update**

### Via CLI

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker compose up -d --build
```

## Troubleshooting

### Container Won't Start

Check logs in Portainer or via CLI:

```bash
docker compose logs blkfndr-app
```

Common issues:
- **Missing environment variables**: Verify all required vars in `.env`
- **Port conflict**: Ensure port 9002 is not already in use
- **Build failures**: Check Docker build logs in Portainer

### OAuth Redirect Issues

Update OAuth redirect URIs in Google Cloud Console:
- Development: `http://localhost:9002/login`
- Production: `https://your-domain.com/login`

Set `NEXT_PUBLIC_APP_URL` in `.env` to match your deployment URL.

### Pinata Gateway Issues

Verify:
- `NEXT_PUBLIC_PINATA_JWT` is valid
- `NEXT_PUBLIC_PINATA_GATEWAY_URL` is accessible
- Pinata group ID is correct

### Blockchain Connection Issues

Ensure:
- `NEXT_PUBLIC_CONTRACT_ADDRESS` and `NEXT_PUBLIC_PLATFORM_ADDRESS` are correct
- Stellar Testnet is accessible from your server
- No firewall blocking Soroban RPC endpoint (`https://soroban-testnet.stellar.org`)
- No firewall blocking Horizon API endpoint (`https://horizon-testnet.stellar.org`)

## Production Deployment Checklist

- [ ] Copy `.env.example` to `.env` and configure all variables
- [ ] Set `NODE_ENV=production` in `.env`
- [ ] Configure OAuth redirect URIs in Google Cloud Console
- [ ] Update `NEXT_PUBLIC_APP_URL` to production domain
- [ ] Set up SSL/TLS (use reverse proxy like Nginx or Traefik)
- [ ] Configure firewall rules (allow port 9002 or your custom port)
- [ ] Set up automated backups for volumes
- [ ] Enable container restart policy (`restart: unless-stopped` is default)
- [ ] Monitor logs and health checks

## Reverse Proxy Setup (Optional)

For production with SSL, use Nginx as reverse proxy:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:9002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Volume Management

The stack creates a persistent volume for Next.js cache:

```bash
# View volumes
docker volume ls | grep blkfndr

# Inspect volume
docker volume inspect blkfndr_next-cache

# Backup volume (optional)
docker run --rm -v blkfndr_next-cache:/data -v $(pwd):/backup alpine tar czf /backup/next-cache-backup.tar.gz -C /data .
```

## Environment Variables Reference

See `.env.example` for a complete list of required environment variables.

Critical variables:
- `NEXT_PUBLIC_STELLAR_NETWORK` — Stellar network (`testnet` or `mainnet`)
- `NEXT_PUBLIC_SOROBAN_RPC_URL` — Soroban RPC endpoint
- `NEXT_PUBLIC_CONTRACT_ADDRESS` — Soroban crowdfunding contract ID
- `NEXT_PUBLIC_PINATA_JWT` — IPFS file uploads
- `GOOGLE_GENERATIVEAI_API_KEY` — AI analysis features
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — Google OAuth

## Scaling (Advanced)

For high-traffic deployments, consider:

1. **Load balancing**: Run multiple container replicas
   ```bash
   docker compose up -d --scale blkfndr-app=3
   ```

2. **CDN**: Use Cloudflare or similar for static assets

3. **Database caching**: Consider Redis for session management (if needed)

4. **Monitoring**: Integrate with Prometheus/Grafana via Portainer