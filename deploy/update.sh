#!/usr/bin/env bash
# GreatNeck.ai — Rebuild & redeploy after code changes
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
CLUSTER="askmura"
BACKEND_REPO="askmura-backend"
FRONTEND_REPO="askmura-frontend"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

# Parse args
UPDATE_BACKEND=true
UPDATE_FRONTEND=true
if [ "${1:-}" = "--backend" ]; then
    UPDATE_FRONTEND=false
elif [ "${1:-}" = "--frontend" ]; then
    UPDATE_BACKEND=false
fi

log "Logging into ECR..."
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_URI"

if [ "$UPDATE_BACKEND" = true ]; then
    log "Building backend..."
    docker build --platform linux/amd64 -t "$BACKEND_REPO" "$BACKEND_DIR"
    docker tag "$BACKEND_REPO:latest" "$ECR_URI/$BACKEND_REPO:latest"
    docker push "$ECR_URI/$BACKEND_REPO:latest"
    log "Backend image pushed"

    log "Updating backend service..."
    aws ecs update-service --cluster "$CLUSTER" --service "askmura-backend" \
        --force-new-deployment --region "$REGION" >/dev/null
fi

if [ "$UPDATE_FRONTEND" = true ]; then
    log "Building frontend..."
    docker build --platform linux/amd64 -t "$FRONTEND_REPO" "$FRONTEND_DIR"
    docker tag "$FRONTEND_REPO:latest" "$ECR_URI/$FRONTEND_REPO:latest"
    docker push "$ECR_URI/$FRONTEND_REPO:latest"
    log "Frontend image pushed"

    log "Updating frontend service..."
    aws ecs update-service --cluster "$CLUSTER" --service "askmura-frontend" \
        --force-new-deployment --region "$REGION" >/dev/null
fi

log "Waiting for services to stabilize..."
for i in $(seq 1 60); do
    BE_RUNNING=$(aws ecs describe-services --cluster "$CLUSTER" --services "askmura-backend" \
        --region "$REGION" --query 'services[0].runningCount' --output text 2>/dev/null)
    FE_RUNNING=$(aws ecs describe-services --cluster "$CLUSTER" --services "askmura-frontend" \
        --region "$REGION" --query 'services[0].runningCount' --output text 2>/dev/null)

    if [ "$BE_RUNNING" = "1" ] && [ "$FE_RUNNING" = "1" ]; then
        break
    fi
    sleep 5
done

ALB_DNS=$(aws elbv2 describe-load-balancers --names "askmura-alb" --region "$REGION" \
    --query 'LoadBalancers[0].DNSName' --output text 2>/dev/null)

echo ""
log "Update complete!"
echo ""
echo "  URL:     http://$ALB_DNS/"
echo "  Health:  http://$ALB_DNS/health"
echo ""
echo "  Usage:"
echo "    ./deploy/update.sh              # Update both"
echo "    ./deploy/update.sh --backend    # Backend only"
echo "    ./deploy/update.sh --frontend   # Frontend only"
echo ""
