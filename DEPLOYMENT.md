# GCP Cloud Run Deployment Guide

This guide covers deploying the AI Meeting Notetaker to Google Cloud Platform (GCP) using Cloud Run and Cloud SQL.

## Architecture Overview

- **Frontend**: React app served via nginx (Cloud Run service)
- **Backend**: FastAPI + Node.js bot-runner (Cloud Run service)
- **Database**: PostgreSQL (Cloud SQL managed instance)

Both services expose port 8080 as required by Cloud Run.

---

## Prerequisites

1. **GCP Account** with billing enabled
2. **gcloud CLI** installed and configured
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```
3. **Docker** installed locally (for testing)
4. **Enable required GCP APIs**:
   ```bash
   gcloud services enable run.googleapis.com
   gcloud services enable sqladmin.googleapis.com
   gcloud services enable containerregistry.googleapis.com
   gcloud services enable cloudbuild.googleapis.com
   ```

---

## Step 1: Create Cloud SQL PostgreSQL Instance

### Create the database instance:

```bash
# Create Cloud SQL instance (adjust region as needed)
gcloud sql instances create ai-notetaker-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1 \
  --root-password=YOUR_SECURE_PASSWORD

# Create database
gcloud sql databases create ai_notetaker --instance=ai-notetaker-db

# Create database user
gcloud sql users create appuser \
  --instance=ai-notetaker-db \
  --password=YOUR_APP_PASSWORD
```

### Get connection details:

```bash
# Get instance connection name
gcloud sql instances describe ai-notetaker-db --format="value(connectionName)"
# Output: PROJECT_ID:REGION:INSTANCE_NAME
```

---

## Step 2: Configure Environment Variables

Create a `.env.production` file for Cloud Run deployment (DO NOT commit this file):

```bash
# Database (Cloud SQL)
DATABASE_URL=postgresql://appuser:YOUR_APP_PASSWORD@/ai_notetaker?host=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME

# Bot Service Token (generate a secure random token)
BOT_SERVICE_TOKEN=your-secure-random-token-here

# Webex API Settings
WEBEX_CLIENT_ID=your-webex-client-id
WEBEX_CLIENT_SECRET=your-webex-client-secret
WEBEX_REFRESH_TOKEN=your-webex-refresh-token
WEBEX_PERSONAL_ACCESS_TOKEN=your-webex-personal-token

# Whisper Transcription Settings
WHISPER_GROQ_API=your-groq-api-key
WHISPER_MODEL=whisper-large-v3
GROQ_API_BASE_URL=https://api.groq.com/openai/v1

# Bot Runner
BOT_RUNNER_URL=http://localhost:3001

# Frontend URL (update after deploying frontend)
VITE_BACKEND_URL=https://your-backend-service-url.run.app
```

---

## Step 3: Build and Deploy Backend

### Build and push Docker image:

```bash
cd services/backend

# Build and push to Google Container Registry
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/ai-notetaker-backend

# Alternative: Build locally and push
docker build -t gcr.io/YOUR_PROJECT_ID/ai-notetaker-backend .
docker push gcr.io/YOUR_PROJECT_ID/ai-notetaker-backend
```

### Deploy to Cloud Run:

```bash
gcloud run deploy ai-notetaker-backend \
  --image gcr.io/YOUR_PROJECT_ID/ai-notetaker-backend \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --add-cloudsql-instances PROJECT_ID:REGION:INSTANCE_NAME \
  --set-env-vars "DATABASE_URL=postgresql://appuser:PASSWORD@/ai_notetaker?host=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME" \
  --set-env-vars "BOT_SERVICE_TOKEN=your-token" \
  --set-env-vars "WEBEX_CLIENT_ID=your-id" \
  --set-env-vars "WEBEX_CLIENT_SECRET=your-secret" \
  --set-env-vars "WHISPER_GROQ_API=your-api-key" \
  --memory 2Gi \
  --cpu 2 \
  --timeout 900 \
  --max-instances 10
```

**Important Notes:**
- **Memory/CPU**: Bot-runner with Puppeteer needs at least 2GB RAM and 2 CPUs
- **Timeout**: Increased for long-running meeting sessions
- **Cloud SQL**: The `--add-cloudsql-instances` flag enables Unix socket connection

**Get the backend URL:**
```bash
gcloud run services describe ai-notetaker-backend --region us-central1 --format="value(status.url)"
```

---

## Step 4: Build and Deploy Frontend

### Update frontend environment:

Create `services/frontend/.env.production`:
```bash
VITE_BACKEND_URL=https://your-backend-url.run.app
```

### Build and deploy:

```bash
cd services/frontend

# Build and push to Google Container Registry
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/ai-notetaker-frontend

# Deploy to Cloud Run
gcloud run deploy ai-notetaker-frontend \
  --image gcr.io/YOUR_PROJECT_ID/ai-notetaker-frontend \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "VITE_BACKEND_URL=https://your-backend-url.run.app" \
  --memory 512Mi \
  --cpu 1 \
  --max-instances 100
```

**Get the frontend URL:**
```bash
gcloud run services describe ai-notetaker-frontend --region us-central1 --format="value(status.url)"
```

---

## Step 5: Update CORS Settings

Update backend CORS to allow your frontend domain:

Edit `services/backend/main.py`:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://your-frontend-url.run.app",
        "http://localhost:3000"  # For local development
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Redeploy backend after updating CORS.

---

## Step 6: Verify Deployment

### Test backend health:
```bash
curl https://your-backend-url.run.app/health
```

### Test frontend:
```bash
curl https://your-frontend-url.run.app/health
```

### Check database connection:
```bash
curl https://your-backend-url.run.app/
# Should return API info without errors
```

---

## Local Testing with Docker

### Test backend locally:

```bash
cd services/backend

# Build image
docker build -t ai-notetaker-backend .

# Run with local PostgreSQL
docker run -p 8080:8080 \
  -e DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:5432/ai_notetaker" \
  -e BOT_SERVICE_TOKEN="dev-token" \
  ai-notetaker-backend
```

### Test frontend locally:

```bash
cd services/frontend

# Build image
docker build -t ai-notetaker-frontend .

# Run container
docker run -p 8080:8080 ai-notetaker-frontend

# Access at http://localhost:8080
```

---

## Monitoring and Logs

### View logs:
```bash
# Backend logs
gcloud run services logs read ai-notetaker-backend --region us-central1 --limit 50

# Frontend logs
gcloud run services logs read ai-notetaker-frontend --region us-central1 --limit 50
```

### Monitor in GCP Console:
- **Cloud Run**: https://console.cloud.google.com/run
- **Cloud SQL**: https://console.cloud.google.com/sql
- **Logs**: https://console.cloud.google.com/logs

---

## Cost Optimization

### Cloud Run pricing is based on:
- **Requests**: First 2 million free per month
- **CPU time**: Only when processing requests
- **Memory time**: Only when processing requests

### Tips:
1. Set `--min-instances 0` (default) for serverless scaling
2. Use `--max-instances` to control costs
3. Backend: Use `--cpu-throttling` for non-CPU-intensive workloads
4. Monitor usage in GCP Console → Billing

### Cloud SQL:
- Use `db-f1-micro` for development/testing
- Consider `db-g1-small` or higher for production
- Enable automated backups

---

## Troubleshooting

### Backend won't start:
1. Check logs: `gcloud run services logs read ai-notetaker-backend`
2. Verify Cloud SQL connection string
3. Ensure environment variables are set correctly
4. Check memory/CPU allocation (bot-runner needs ≥2GB)

### Frontend 404 errors:
1. Verify nginx.conf is included in Docker image
2. Check that `try_files` directive is correct for SPA routing
3. Inspect nginx logs in Cloud Run

### Database connection errors:
1. Verify Cloud SQL instance is running
2. Check `--add-cloudsql-instances` flag is set
3. Ensure DATABASE_URL uses Unix socket path: `?host=/cloudsql/...`
4. Verify database user permissions

### Bot-runner failures:
1. Check if Chromium/Puppeteer is installed in Docker image
2. Increase memory allocation (try 2Gi or 4Gi)
3. Check `PUPPETEER_EXECUTABLE_PATH` environment variable
4. Review bot-runner logs in backend service logs

---

## Security Best Practices

1. **Never commit `.env` files** - Add to `.gitignore`
2. **Use Secret Manager** for sensitive values:
   ```bash
   gcloud run deploy SERVICE \
     --set-secrets "WEBEX_CLIENT_SECRET=webex-secret:latest"
   ```
3. **Restrict CORS** to your actual frontend domain
4. **Enable authentication** for production (remove `--allow-unauthenticated`)
5. **Use VPC** for Cloud SQL private IP connection
6. **Enable Cloud Armor** for DDoS protection
7. **Regular security updates** - Rebuild images monthly

---

## CI/CD with Cloud Build

Create `cloudbuild.yaml` in project root:

```yaml
steps:
  # Build backend
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'gcr.io/$PROJECT_ID/ai-notetaker-backend', './services/backend']
  
  # Build frontend
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'gcr.io/$PROJECT_ID/ai-notetaker-frontend', './services/frontend']
  
  # Push images
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'gcr.io/$PROJECT_ID/ai-notetaker-backend']
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'gcr.io/$PROJECT_ID/ai-notetaker-frontend']
  
  # Deploy backend
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args: ['run', 'deploy', 'ai-notetaker-backend', 
           '--image', 'gcr.io/$PROJECT_ID/ai-notetaker-backend',
           '--region', 'us-central1']
  
  # Deploy frontend
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args: ['run', 'deploy', 'ai-notetaker-frontend',
           '--image', 'gcr.io/$PROJECT_ID/ai-notetaker-frontend',
           '--region', 'us-central1']

images:
  - 'gcr.io/$PROJECT_ID/ai-notetaker-backend'
  - 'gcr.io/$PROJECT_ID/ai-notetaker-frontend'
```

Trigger builds:
```bash
gcloud builds submit --config cloudbuild.yaml
```

---

## Scaling Considerations

### Frontend:
- Stateless, scales horizontally easily
- Can handle 100+ concurrent instances
- Consider Cloud CDN for global distribution

### Backend:
- Bot-runner may limit concurrent meetings per instance
- Consider `--max-instances` based on expected concurrent meetings
- Monitor CPU/memory usage per instance

### Database:
- Start with db-f1-micro (0.6GB RAM, 1 vCPU)
- Upgrade to db-g1-small+ as usage grows
- Enable read replicas for high read traffic
- Consider connection pooling (PgBouncer) if needed

---

## Support

For issues or questions:
1. Check Cloud Run logs
2. Review this documentation
3. Consult GCP documentation: https://cloud.google.com/run/docs
4. Check application README.md for app-specific details

