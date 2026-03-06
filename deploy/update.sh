#!/usr/bin/env bash
# DEPRECATED — This was the old AWS ECS deploy script.
# Production is now on GCP Cloud Run.
#
# Use instead:
#   ./deploy/gcp-update.sh              # Update both
#   ./deploy/gcp-update.sh --backend    # Backend only
#   ./deploy/gcp-update.sh --frontend   # Frontend only
#   ./deploy/gcp-update.sh --knowledge  # Sync knowledge data

echo "ERROR: This script deploys to AWS ECS which is no longer used."
echo ""
echo "Production is on GCP Cloud Run. Use:"
echo "  ./deploy/gcp-update.sh              # Update both"
echo "  ./deploy/gcp-update.sh --backend    # Backend only"
echo "  ./deploy/gcp-update.sh --frontend   # Frontend only"
echo ""
exit 1
