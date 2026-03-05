#!/usr/bin/env bash
# Quick rebuild & redeploy for AskMura on GCP Cloud Run
# Usage: ./deploy/gcp-update.sh [--backend] [--frontend] [--knowledge]
set -euo pipefail

PROJECT_ID="askmura"
REGION="us-east1"
REPO="askmura"
BUCKET="askmura-knowledge"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE_BASE="us-east1-docker.pkg.dev/$PROJECT_ID/$REPO"

DO_BACKEND=false
DO_FRONTEND=false
DO_KNOWLEDGE=false

if [ $# -eq 0 ]; then
  DO_BACKEND=true
  DO_FRONTEND=true
fi

for arg in "$@"; do
  case $arg in
    --backend)   DO_BACKEND=true ;;
    --frontend)  DO_FRONTEND=true ;;
    --knowledge) DO_KNOWLEDGE=true ;;
    *) echo "Usage: $0 [--backend] [--frontend] [--knowledge]"; exit 1 ;;
  esac
done

gcloud config set project "$PROJECT_ID" --quiet

if $DO_KNOWLEDGE; then
  echo "→ Syncing knowledge data to GCS..."
  gcloud storage rsync -r "$PROJECT_DIR/knowledge/" "gs://$BUCKET/" --quiet
  echo "  ✓ Knowledge synced"
fi

if $DO_BACKEND; then
  echo "→ Building backend..."
  docker build --platform linux/amd64 -t "$IMAGE_BASE/backend" "$PROJECT_DIR/backend/"
  echo "→ Pushing backend..."
  docker push "$IMAGE_BASE/backend"
  echo "→ Deploying backend..."
  gcloud run deploy askmura-backend \
    --image "$IMAGE_BASE/backend" \
    --region "$REGION" --quiet
  echo "  ✓ Backend updated"
fi

if $DO_FRONTEND; then
  echo "→ Building frontend..."
  docker build --platform linux/amd64 -t "$IMAGE_BASE/frontend" "$PROJECT_DIR/frontend/"
  echo "→ Pushing frontend..."
  docker push "$IMAGE_BASE/frontend"
  echo "→ Deploying frontend..."
  gcloud run deploy askmura-frontend \
    --image "$IMAGE_BASE/frontend" \
    --region "$REGION" --quiet
  echo "  ✓ Frontend updated"
fi

echo ""
echo "=== Update Complete ==="
if $DO_BACKEND; then
  echo "Backend:  $(gcloud run services describe askmura-backend --region "$REGION" --format='value(status.url)' 2>/dev/null)"
fi
if $DO_FRONTEND; then
  echo "Frontend: $(gcloud run services describe askmura-frontend --region "$REGION" --format='value(status.url)' 2>/dev/null)"
fi
