#!/usr/bin/env bash
# Full idempotent GCP deployment for AskMura / greatneck.ai
# Usage: ./deploy/gcp-deploy.sh
set -euo pipefail

PROJECT_ID="askmura"
REGION="us-east1"
REPO="askmura"
DOMAIN="greatneck.ai"
BUCKET="askmura-knowledge"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE_BASE="us-east1-docker.pkg.dev/$PROJECT_ID/$REPO"

echo "=== AskMura GCP Deploy ==="
echo "Project: $PROJECT_ID | Region: $REGION | Domain: $DOMAIN"
echo ""

# ── 1. Configure project & enable APIs ───────────────────────────
echo "→ Setting project and enabling APIs..."
gcloud config set project "$PROJECT_ID" --quiet
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  compute.googleapis.com \
  --quiet

# ── 2. IAM: Grant default compute SA access to secrets & storage ─
echo "→ Configuring IAM..."
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for role in roles/secretmanager.secretAccessor roles/storage.objectAdmin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA" --role="$role" \
    --quiet --no-user-output-enabled
done
echo "  ✓ IAM roles granted to $SA"

# ── 3. Artifact Registry ─────────────────────────────────────────
echo "→ Creating Artifact Registry repo..."
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker --location="$REGION" --quiet 2>/dev/null || true
echo "  ✓ $IMAGE_BASE"

# ── 4. GCS bucket & knowledge sync ───────────────────────────────
echo "→ Setting up GCS bucket..."
gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --quiet 2>/dev/null || true

echo "→ Syncing knowledge data to gs://$BUCKET/ ..."
gcloud storage rsync -r "$PROJECT_DIR/knowledge/" "gs://$BUCKET/" --quiet
echo "  ✓ Knowledge synced"

# ── 5. Secrets ────────────────────────────────────────────────────
echo "→ Creating/updating secrets..."
SECRETS="ANTHROPIC_API_KEY OPENAI_API_KEY GEMINI_API_KEY TAVILY_API_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET JWT_SECRET"

for secret in $SECRETS; do
  value=$(grep "^${secret}=" "$PROJECT_DIR/.env" | head -1 | cut -d= -f2-)
  if [ -z "$value" ]; then value="PLACEHOLDER"; fi

  if gcloud secrets describe "$secret" --quiet 2>/dev/null; then
    echo -n "$value" | gcloud secrets versions add "$secret" --data-file=- --quiet
  else
    echo -n "$value" | gcloud secrets create "$secret" --data-file=- --quiet
  fi
  echo "  ✓ $secret"
done

# ── 6. Build & push Docker images ────────────────────────────────
echo "→ Configuring Docker auth..."
gcloud auth configure-docker us-east1-docker.pkg.dev --quiet

echo "→ Building backend image..."
docker build --platform linux/amd64 -t "$IMAGE_BASE/backend" "$PROJECT_DIR/backend/"
echo "→ Pushing backend image..."
docker push "$IMAGE_BASE/backend"

echo "→ Building frontend image..."
docker build --platform linux/amd64 -t "$IMAGE_BASE/frontend" "$PROJECT_DIR/frontend/"
echo "→ Pushing frontend image..."
docker push "$IMAGE_BASE/frontend"

# ── 7. Deploy Cloud Run services ─────────────────────────────────
echo "→ Deploying backend to Cloud Run..."
gcloud run deploy askmura-backend \
  --image "$IMAGE_BASE/backend" \
  --region "$REGION" \
  --platform managed \
  --port 8001 \
  --memory 1Gi --cpu 1 \
  --min-instances 1 --max-instances 3 \
  --timeout 300 \
  --set-secrets="ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest,TAVILY_API_KEY=TAVILY_API_KEY:latest,GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest,GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest,JWT_SECRET=JWT_SECRET:latest" \
  --set-env-vars="^::^KNOWLEDGE_DIR=/data/knowledge::CORS_ORIGINS=https://greatneck.ai,https://www.greatneck.ai::FRONTEND_URL=https://greatneck.ai::GOOGLE_REDIRECT_URI=https://greatneck.ai/api/auth/google/callback::ADMIN_EMAILS=duyuanvvv@gmail.com" \
  --clear-volumes \
  --add-volume=name=knowledge,type=cloud-storage,bucket="$BUCKET" \
  --add-volume-mount=volume=knowledge,mount-path=/data/knowledge \
  --execution-environment=gen2 \
  --no-cpu-throttling \
  --allow-unauthenticated \
  --quiet
echo "  ✓ Backend deployed"

echo "→ Deploying frontend to Cloud Run..."
gcloud run deploy askmura-frontend \
  --image "$IMAGE_BASE/frontend" \
  --region "$REGION" \
  --platform managed \
  --port 80 \
  --memory 256Mi --cpu 1 \
  --min-instances 0 --max-instances 3 \
  --allow-unauthenticated \
  --quiet
echo "  ✓ Frontend deployed"

# ── 8. Load Balancer ─────────────────────────────────────────────
echo "→ Setting up Cloud Load Balancer..."

# Reserve static IP
gcloud compute addresses create askmura-ip --global --ip-version=IPV4 --quiet 2>/dev/null || true
LB_IP=$(gcloud compute addresses describe askmura-ip --global --format='value(address)')
echo "  Static IP: $LB_IP"

# Serverless NEGs
for svc in backend frontend; do
  gcloud compute network-endpoint-groups create "askmura-${svc}-neg" \
    --region="$REGION" --network-endpoint-type=serverless \
    --cloud-run-service="askmura-${svc}" --quiet 2>/dev/null || true
done
echo "  ✓ Network endpoint groups"

# Backend services
for svc in backend frontend; do
  gcloud compute backend-services create "askmura-${svc}-bs" \
    --global --load-balancing-scheme=EXTERNAL_MANAGED --quiet 2>/dev/null || true
  gcloud compute backend-services add-backend "askmura-${svc}-bs" \
    --global --network-endpoint-group="askmura-${svc}-neg" \
    --network-endpoint-group-region="$REGION" --quiet 2>/dev/null || true
done
echo "  ✓ Backend services"

# URL map: frontend default, /api/* and /health → backend
gcloud compute url-maps create askmura-urlmap \
  --default-service=askmura-frontend-bs --quiet 2>/dev/null || true

gcloud compute url-maps add-path-matcher askmura-urlmap \
  --path-matcher-name=routes \
  --default-service=askmura-frontend-bs \
  --new-hosts="*" \
  --path-rules="/api/*=askmura-backend-bs,/health=askmura-backend-bs" \
  --quiet 2>/dev/null || true
echo "  ✓ URL map"

# Managed SSL certificate
gcloud compute ssl-certificates create askmura-cert \
  --domains="$DOMAIN,www.$DOMAIN" --global --quiet 2>/dev/null || true
echo "  ✓ SSL certificate (provisioning starts after DNS points here)"

# HTTPS proxy & forwarding rule
gcloud compute target-https-proxies create askmura-https-proxy \
  --url-map=askmura-urlmap --ssl-certificates=askmura-cert --quiet 2>/dev/null || true

gcloud compute forwarding-rules create askmura-https-fw \
  --global --target-https-proxy=askmura-https-proxy \
  --address=askmura-ip --ports=443 \
  --load-balancing-scheme=EXTERNAL_MANAGED --quiet 2>/dev/null || true
echo "  ✓ HTTPS forwarding"

# HTTP → HTTPS redirect
cat > /tmp/askmura-http-redirect.yaml <<'YAML'
name: askmura-http-redirect
defaultUrlRedirect:
  httpsRedirect: true
  redirectResponseCode: MOVED_PERMANENTLY_DEFAULT
YAML

gcloud compute url-maps import askmura-http-redirect \
  --source=/tmp/askmura-http-redirect.yaml --global --quiet 2>/dev/null || true

gcloud compute target-http-proxies create askmura-http-proxy \
  --url-map=askmura-http-redirect --quiet 2>/dev/null || true

gcloud compute forwarding-rules create askmura-http-fw \
  --global --target-http-proxy=askmura-http-proxy \
  --address=askmura-ip --ports=80 \
  --load-balancing-scheme=EXTERNAL_MANAGED --quiet 2>/dev/null || true
echo "  ✓ HTTP → HTTPS redirect"

# ── 9. Summary ───────────────────────────────────────────────────
echo ""
echo "========================================="
echo "  Deployment Complete"
echo "========================================="
echo ""
echo "Load Balancer IP: $LB_IP"
echo ""
echo "Cloud Run URLs (direct, for testing before DNS):"
echo "  Backend:  $(gcloud run services describe askmura-backend --region "$REGION" --format='value(status.url)' 2>/dev/null || echo 'N/A')"
echo "  Frontend: $(gcloud run services describe askmura-frontend --region "$REGION" --format='value(status.url)' 2>/dev/null || echo 'N/A')"
echo ""
echo "NEXT STEPS:"
echo "  1. Point DNS A records to $LB_IP:"
echo "       $DOMAIN       → $LB_IP"
echo "       www.$DOMAIN   → $LB_IP"
echo "  2. Wait ~15 min for SSL cert provisioning after DNS propagates"
echo "  3. Update Google OAuth redirect URI to:"
echo "       https://$DOMAIN/api/auth/google/callback"
echo "  4. Test: curl https://$DOMAIN/health"
echo ""
