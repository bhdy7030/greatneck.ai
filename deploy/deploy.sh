#!/usr/bin/env bash
# DEPRECATED — This was the old AWS ECS Fargate full infrastructure setup.
# Production is now on GCP Cloud Run.
#
# Use instead:
#   ./deploy/gcp-deploy.sh   # Full idempotent GCP setup
#   ./deploy/gcp-update.sh   # Quick rebuild & redeploy

echo "ERROR: This script deploys to AWS ECS which is no longer used."
echo ""
echo "Production is on GCP Cloud Run. Use:"
echo "  ./deploy/gcp-deploy.sh   # Full idempotent GCP setup"
echo "  ./deploy/gcp-update.sh   # Quick rebuild & redeploy"
echo ""
exit 1
