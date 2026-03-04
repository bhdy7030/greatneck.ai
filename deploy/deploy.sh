#!/usr/bin/env bash
# AskMura — Full AWS ECS Fargate Deployment
# Idempotent: safe to re-run. Creates resources only if they don't exist.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PROJECT="askmura"
CLUSTER="askmura"
BACKEND_REPO="askmura-backend"
FRONTEND_REPO="askmura-frontend"
LOG_GROUP="/ecs/askmura"
SECRET_NAME="askmura/api-keys"
EFS_NAME="askmura-knowledge"
ALB_NAME="askmura-alb"
BACKEND_TG="askmura-backend-tg"
FRONTEND_TG="askmura-frontend-tg"
TASK_ROLE_NAME="askmura-task-role"
EXEC_ROLE_NAME="askmura-exec-role"
SG_ALB_NAME="askmura-alb-sg"
SG_ECS_NAME="askmura-ecs-sg"
SG_EFS_NAME="askmura-efs-sg"

# Directories (relative to this script)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
KNOWLEDGE_DIR="$ROOT_DIR/knowledge"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*" >&2; }

# ------------------------------------------------------------------
# 0. Prerequisites
# ------------------------------------------------------------------
check_prerequisites() {
    log "Checking prerequisites..."

    if ! command -v aws &>/dev/null; then
        err "AWS CLI not found. Install it first:"
        echo "  brew install awscli        # macOS"
        echo "  curl https://awscli.amazonaws.com/AWSCLIV2.pkg -o AWSCLIV2.pkg && sudo installer -pkg AWSCLIV2.pkg -target /"
        exit 1
    fi

    if ! aws sts get-caller-identity &>/dev/null; then
        err "AWS CLI not configured. Run:"
        echo "  aws configure"
        echo "  (Enter your Access Key ID, Secret Access Key, region: $REGION, output: json)"
        exit 1
    fi

    if ! command -v docker &>/dev/null; then
        err "Docker not found. Install Docker Desktop first."
        exit 1
    fi

    if ! docker info &>/dev/null 2>&1; then
        err "Docker daemon not running. Start Docker Desktop first."
        exit 1
    fi

    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    ECR_URI="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
    log "AWS Account: $ACCOUNT_ID  Region: $REGION"
}

# ------------------------------------------------------------------
# 1. ECR Repositories
# ------------------------------------------------------------------
create_ecr_repos() {
    log "Setting up ECR repositories..."

    for repo in "$BACKEND_REPO" "$FRONTEND_REPO"; do
        if aws ecr describe-repositories --repository-names "$repo" --region "$REGION" &>/dev/null; then
            log "  ECR repo '$repo' already exists"
        else
            aws ecr create-repository --repository-name "$repo" --region "$REGION" \
                --image-scanning-configuration scanOnPush=true --query 'repository.repositoryUri' --output text
            log "  Created ECR repo '$repo'"
        fi
    done
}

# ------------------------------------------------------------------
# 2. Build & Push Docker Images
# ------------------------------------------------------------------
build_and_push() {
    log "Logging into ECR..."
    aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_URI"

    log "Building backend image..."
    docker build --platform linux/amd64 -t "$BACKEND_REPO" "$BACKEND_DIR"
    docker tag "$BACKEND_REPO:latest" "$ECR_URI/$BACKEND_REPO:latest"
    docker push "$ECR_URI/$BACKEND_REPO:latest"
    log "  Backend image pushed"

    log "Building frontend image..."
    docker build --platform linux/amd64 -t "$FRONTEND_REPO" "$FRONTEND_DIR"
    docker tag "$FRONTEND_REPO:latest" "$ECR_URI/$FRONTEND_REPO:latest"
    docker push "$ECR_URI/$FRONTEND_REPO:latest"
    log "  Frontend image pushed"
}

# ------------------------------------------------------------------
# 3. Networking (VPC, Subnets, Security Groups)
# ------------------------------------------------------------------
setup_networking() {
    log "Setting up networking..."

    # Use default VPC
    VPC_ID=$(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" \
        --query 'Vpcs[0].VpcId' --output text --region "$REGION")

    if [ "$VPC_ID" = "None" ] || [ -z "$VPC_ID" ]; then
        err "No default VPC found. Create one with: aws ec2 create-default-vpc"
        exit 1
    fi
    log "  Using default VPC: $VPC_ID"

    # Get subnets (need at least 2 for ALB)
    SUBNET_IDS=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" \
        --query 'Subnets[*].SubnetId' --output text --region "$REGION")
    SUBNET_ARRAY=($SUBNET_IDS)

    if [ ${#SUBNET_ARRAY[@]} -lt 2 ]; then
        err "Need at least 2 subnets for ALB. Found: ${#SUBNET_ARRAY[@]}"
        exit 1
    fi
    # Use first 2 subnets
    SUBNET_1="${SUBNET_ARRAY[0]}"
    SUBNET_2="${SUBNET_ARRAY[1]}"
    log "  Using subnets: $SUBNET_1, $SUBNET_2"

    # Security Group: ALB (allow port 80 from anywhere)
    SG_ALB_ID=$(aws ec2 describe-security-groups \
        --filters "Name=group-name,Values=$SG_ALB_NAME" "Name=vpc-id,Values=$VPC_ID" \
        --query 'SecurityGroups[0].GroupId' --output text --region "$REGION" 2>/dev/null)

    if [ "$SG_ALB_ID" = "None" ] || [ -z "$SG_ALB_ID" ]; then
        SG_ALB_ID=$(aws ec2 create-security-group --group-name "$SG_ALB_NAME" \
            --description "ALB security group" --vpc-id "$VPC_ID" \
            --query 'GroupId' --output text --region "$REGION")
        aws ec2 authorize-security-group-ingress --group-id "$SG_ALB_ID" \
            --protocol tcp --port 80 --cidr 0.0.0.0/0 --region "$REGION"
        log "  Created ALB security group: $SG_ALB_ID"
    else
        log "  ALB security group exists: $SG_ALB_ID"
    fi

    # Security Group: ECS (allow traffic from ALB)
    SG_ECS_ID=$(aws ec2 describe-security-groups \
        --filters "Name=group-name,Values=$SG_ECS_NAME" "Name=vpc-id,Values=$VPC_ID" \
        --query 'SecurityGroups[0].GroupId' --output text --region "$REGION" 2>/dev/null)

    if [ "$SG_ECS_ID" = "None" ] || [ -z "$SG_ECS_ID" ]; then
        SG_ECS_ID=$(aws ec2 create-security-group --group-name "$SG_ECS_NAME" \
            --description "ECS tasks security group" --vpc-id "$VPC_ID" \
            --query 'GroupId' --output text --region "$REGION")
        aws ec2 authorize-security-group-ingress --group-id "$SG_ECS_ID" \
            --protocol tcp --port 0-65535 --source-group "$SG_ALB_ID" --region "$REGION"
        log "  Created ECS security group: $SG_ECS_ID"
    else
        log "  ECS security group exists: $SG_ECS_ID"
    fi

    # Security Group: EFS (allow NFS from ECS)
    SG_EFS_ID=$(aws ec2 describe-security-groups \
        --filters "Name=group-name,Values=$SG_EFS_NAME" "Name=vpc-id,Values=$VPC_ID" \
        --query 'SecurityGroups[0].GroupId' --output text --region "$REGION" 2>/dev/null)

    if [ "$SG_EFS_ID" = "None" ] || [ -z "$SG_EFS_ID" ]; then
        SG_EFS_ID=$(aws ec2 create-security-group --group-name "$SG_EFS_NAME" \
            --description "EFS security group" --vpc-id "$VPC_ID" \
            --query 'GroupId' --output text --region "$REGION")
        aws ec2 authorize-security-group-ingress --group-id "$SG_EFS_ID" \
            --protocol tcp --port 2049 --source-group "$SG_ECS_ID" --region "$REGION"
        log "  Created EFS security group: $SG_EFS_ID"
    else
        log "  EFS security group exists: $SG_EFS_ID"
    fi
}

# ------------------------------------------------------------------
# 4. EFS Filesystem
# ------------------------------------------------------------------
setup_efs() {
    log "Setting up EFS..."

    EFS_ID=$(aws efs describe-file-systems \
        --query "FileSystems[?Name=='$EFS_NAME'].FileSystemId | [0]" \
        --output text --region "$REGION" 2>/dev/null)

    if [ "$EFS_ID" = "None" ] || [ -z "$EFS_ID" ]; then
        EFS_ID=$(aws efs create-file-system \
            --performance-mode generalPurpose \
            --throughput-mode bursting \
            --tags "Key=Name,Value=$EFS_NAME" \
            --query 'FileSystemId' --output text --region "$REGION")
        log "  Created EFS: $EFS_ID"

        # Wait for EFS to be available
        log "  Waiting for EFS to become available..."
        aws efs describe-file-systems --file-system-id "$EFS_ID" --region "$REGION" \
            --query 'FileSystems[0].LifeCycleState' --output text
        while true; do
            STATE=$(aws efs describe-file-systems --file-system-id "$EFS_ID" --region "$REGION" \
                --query 'FileSystems[0].LifeCycleState' --output text)
            [ "$STATE" = "available" ] && break
            sleep 2
        done
    else
        log "  EFS already exists: $EFS_ID"
    fi

    # Create mount targets in each subnet
    for SUBNET in "$SUBNET_1" "$SUBNET_2"; do
        EXISTING=$(aws efs describe-mount-targets --file-system-id "$EFS_ID" --region "$REGION" \
            --query "MountTargets[?SubnetId=='$SUBNET'].MountTargetId | [0]" --output text)
        if [ "$EXISTING" = "None" ] || [ -z "$EXISTING" ]; then
            aws efs create-mount-target --file-system-id "$EFS_ID" \
                --subnet-id "$SUBNET" --security-groups "$SG_EFS_ID" --region "$REGION" >/dev/null
            log "  Created mount target in $SUBNET"
        else
            log "  Mount target already exists in $SUBNET"
        fi
    done

    # Wait for mount targets to be available
    log "  Waiting for mount targets..."
    while true; do
        STATES=$(aws efs describe-mount-targets --file-system-id "$EFS_ID" --region "$REGION" \
            --query 'MountTargets[*].LifeCycleState' --output text)
        if echo "$STATES" | grep -qv "available"; then
            sleep 3
        else
            break
        fi
    done
    log "  EFS mount targets ready"
}

# ------------------------------------------------------------------
# 5. Secrets Manager
# ------------------------------------------------------------------
setup_secrets() {
    log "Setting up Secrets Manager..."

    if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" &>/dev/null; then
        log "  Secret '$SECRET_NAME' already exists"
        warn "  To update secrets: aws secretsmanager update-secret --secret-id $SECRET_NAME --secret-string '{...}'"
        return
    fi

    # Prompt for API keys
    echo ""
    warn "Enter API keys for Secrets Manager (these will be stored securely in AWS):"

    read -rp "  ANTHROPIC_API_KEY: " ANTHROPIC_KEY
    read -rp "  OPENAI_API_KEY (optional, press Enter to skip): " OPENAI_KEY
    read -rp "  TAVILY_API_KEY (optional, press Enter to skip): " TAVILY_KEY

    SECRET_JSON=$(cat <<EOF
{
    "ANTHROPIC_API_KEY": "$ANTHROPIC_KEY",
    "OPENAI_API_KEY": "${OPENAI_KEY:-}",
    "TAVILY_API_KEY": "${TAVILY_KEY:-}"
}
EOF
)

    aws secretsmanager create-secret --name "$SECRET_NAME" \
        --description "AskMura API keys" \
        --secret-string "$SECRET_JSON" \
        --region "$REGION" >/dev/null
    log "  Created secret '$SECRET_NAME'"
}

# ------------------------------------------------------------------
# 6. IAM Roles
# ------------------------------------------------------------------
setup_iam() {
    log "Setting up IAM roles..."

    # ECS Task Execution Role (allows pulling images, reading secrets, writing logs)
    if aws iam get-role --role-name "$EXEC_ROLE_NAME" &>/dev/null; then
        log "  Execution role '$EXEC_ROLE_NAME' already exists"
    else
        aws iam create-role --role-name "$EXEC_ROLE_NAME" \
            --assume-role-policy-document '{
                "Version": "2012-10-17",
                "Statement": [{
                    "Effect": "Allow",
                    "Principal": {"Service": "ecs-tasks.amazonaws.com"},
                    "Action": "sts:AssumeRole"
                }]
            }' >/dev/null

        aws iam attach-role-policy --role-name "$EXEC_ROLE_NAME" \
            --policy-arn "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"

        # Allow reading secrets
        SECRET_ARN=$(aws secretsmanager describe-secret --secret-id "$SECRET_NAME" \
            --query 'ARN' --output text --region "$REGION")

        aws iam put-role-policy --role-name "$EXEC_ROLE_NAME" \
            --policy-name "askmura-secrets-access" \
            --policy-document "{
                \"Version\": \"2012-10-17\",
                \"Statement\": [{
                    \"Effect\": \"Allow\",
                    \"Action\": [
                        \"secretsmanager:GetSecretValue\"
                    ],
                    \"Resource\": \"$SECRET_ARN\"
                }]
            }"
        log "  Created execution role '$EXEC_ROLE_NAME'"
    fi

    EXEC_ROLE_ARN=$(aws iam get-role --role-name "$EXEC_ROLE_NAME" \
        --query 'Role.Arn' --output text)

    # ECS Task Role (permissions for the running container — EFS access)
    if aws iam get-role --role-name "$TASK_ROLE_NAME" &>/dev/null; then
        log "  Task role '$TASK_ROLE_NAME' already exists"
    else
        aws iam create-role --role-name "$TASK_ROLE_NAME" \
            --assume-role-policy-document '{
                "Version": "2012-10-17",
                "Statement": [{
                    "Effect": "Allow",
                    "Principal": {"Service": "ecs-tasks.amazonaws.com"},
                    "Action": "sts:AssumeRole"
                }]
            }' >/dev/null

        aws iam put-role-policy --role-name "$TASK_ROLE_NAME" \
            --policy-name "askmura-efs-access" \
            --policy-document '{
                "Version": "2012-10-17",
                "Statement": [{
                    "Effect": "Allow",
                    "Action": [
                        "elasticfilesystem:ClientMount",
                        "elasticfilesystem:ClientWrite",
                        "elasticfilesystem:ClientRootAccess"
                    ],
                    "Resource": "*"
                }]
            }'
        log "  Created task role '$TASK_ROLE_NAME'"
    fi

    TASK_ROLE_ARN=$(aws iam get-role --role-name "$TASK_ROLE_NAME" \
        --query 'Role.Arn' --output text)
}

# ------------------------------------------------------------------
# 7. CloudWatch Log Group
# ------------------------------------------------------------------
setup_logging() {
    log "Setting up CloudWatch logging..."

    if aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" --region "$REGION" \
        --query "logGroups[?logGroupName=='$LOG_GROUP']" --output text | grep -q "$LOG_GROUP"; then
        log "  Log group '$LOG_GROUP' already exists"
    else
        aws logs create-log-group --log-group-name "$LOG_GROUP" --region "$REGION"
        aws logs put-retention-policy --log-group-name "$LOG_GROUP" \
            --retention-in-days 30 --region "$REGION"
        log "  Created log group '$LOG_GROUP' (30-day retention)"
    fi
}

# ------------------------------------------------------------------
# 8. ECS Cluster
# ------------------------------------------------------------------
setup_cluster() {
    log "Setting up ECS cluster..."

    EXISTING=$(aws ecs describe-clusters --clusters "$CLUSTER" --region "$REGION" \
        --query "clusters[?status=='ACTIVE'].clusterName" --output text 2>/dev/null)

    if [ "$EXISTING" = "$CLUSTER" ]; then
        log "  Cluster '$CLUSTER' already exists"
    else
        aws ecs create-cluster --cluster-name "$CLUSTER" --region "$REGION" >/dev/null
        log "  Created cluster '$CLUSTER'"
    fi
}

# ------------------------------------------------------------------
# 9. ALB + Target Groups + Listener Rules
# ------------------------------------------------------------------
setup_alb() {
    log "Setting up Application Load Balancer..."

    # Check if ALB exists
    ALB_ARN=$(aws elbv2 describe-load-balancers --names "$ALB_NAME" --region "$REGION" \
        --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || echo "None")

    if [ "$ALB_ARN" = "None" ] || [ -z "$ALB_ARN" ]; then
        ALB_ARN=$(aws elbv2 create-load-balancer --name "$ALB_NAME" \
            --subnets "$SUBNET_1" "$SUBNET_2" \
            --security-groups "$SG_ALB_ID" \
            --scheme internet-facing --type application \
            --query 'LoadBalancers[0].LoadBalancerArn' --output text --region "$REGION")
        log "  Created ALB: $ALB_NAME"
    else
        log "  ALB '$ALB_NAME' already exists"
    fi

    ALB_DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" \
        --query 'LoadBalancers[0].DNSName' --output text --region "$REGION")

    # Frontend target group (port 80)
    FE_TG_ARN=$(aws elbv2 describe-target-groups --names "$FRONTEND_TG" --region "$REGION" \
        --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || echo "None")

    if [ "$FE_TG_ARN" = "None" ] || [ -z "$FE_TG_ARN" ]; then
        FE_TG_ARN=$(aws elbv2 create-target-group --name "$FRONTEND_TG" \
            --protocol HTTP --port 80 --vpc-id "$VPC_ID" \
            --target-type ip --health-check-path "/nginx-health" \
            --health-check-interval-seconds 30 \
            --healthy-threshold-count 2 \
            --unhealthy-threshold-count 3 \
            --query 'TargetGroups[0].TargetGroupArn' --output text --region "$REGION")
        log "  Created frontend target group"
    else
        log "  Frontend target group already exists"
    fi

    # Backend target group (port 8001)
    BE_TG_ARN=$(aws elbv2 describe-target-groups --names "$BACKEND_TG" --region "$REGION" \
        --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || echo "None")

    if [ "$BE_TG_ARN" = "None" ] || [ -z "$BE_TG_ARN" ]; then
        BE_TG_ARN=$(aws elbv2 create-target-group --name "$BACKEND_TG" \
            --protocol HTTP --port 8001 --vpc-id "$VPC_ID" \
            --target-type ip --health-check-path "/health" \
            --health-check-interval-seconds 30 \
            --healthy-threshold-count 2 \
            --unhealthy-threshold-count 3 \
            --query 'TargetGroups[0].TargetGroupArn' --output text --region "$REGION")
        log "  Created backend target group"
    else
        log "  Backend target group already exists"
    fi

    # Listener on port 80 — default action → frontend
    LISTENER_ARN=$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --region "$REGION" \
        --query "Listeners[?Port==\`80\`].ListenerArn | [0]" --output text 2>/dev/null)

    if [ "$LISTENER_ARN" = "None" ] || [ -z "$LISTENER_ARN" ]; then
        LISTENER_ARN=$(aws elbv2 create-listener --load-balancer-arn "$ALB_ARN" \
            --protocol HTTP --port 80 \
            --default-action "Type=forward,TargetGroupArn=$FE_TG_ARN" \
            --query 'Listeners[0].ListenerArn' --output text --region "$REGION")
        log "  Created HTTP listener"
    else
        log "  HTTP listener already exists"
    fi

    # Listener rule: /api/* → backend
    EXISTING_RULES=$(aws elbv2 describe-rules --listener-arn "$LISTENER_ARN" --region "$REGION" \
        --query 'Rules[?Priority!=`default`].Priority' --output text 2>/dev/null)

    if [ -z "$EXISTING_RULES" ] || [ "$EXISTING_RULES" = "None" ]; then
        aws elbv2 create-rule --listener-arn "$LISTENER_ARN" \
            --conditions "Field=path-pattern,Values='/api/*'" \
            --priority 10 \
            --actions "Type=forward,TargetGroupArn=$BE_TG_ARN" \
            --region "$REGION" >/dev/null
        log "  Created rule: /api/* → backend"

        # Listener rule: /health → backend
        aws elbv2 create-rule --listener-arn "$LISTENER_ARN" \
            --conditions "Field=path-pattern,Values='/health'" \
            --priority 20 \
            --actions "Type=forward,TargetGroupArn=$BE_TG_ARN" \
            --region "$REGION" >/dev/null
        log "  Created rule: /health → backend"
    else
        log "  Listener rules already exist"
    fi
}

# ------------------------------------------------------------------
# 10. ECS Task Definitions
# ------------------------------------------------------------------
register_task_definitions() {
    log "Registering ECS task definitions..."

    SECRET_ARN=$(aws secretsmanager describe-secret --secret-id "$SECRET_NAME" \
        --query 'ARN' --output text --region "$REGION")

    # Backend task definition
    cat > /tmp/askmura-backend-task.json <<TASKDEF
{
    "family": "askmura-backend",
    "networkMode": "awsvpc",
    "requiresCompatibilities": ["FARGATE"],
    "cpu": "1024",
    "memory": "2048",
    "executionRoleArn": "$EXEC_ROLE_ARN",
    "taskRoleArn": "$TASK_ROLE_ARN",
    "containerDefinitions": [
        {
            "name": "backend",
            "image": "$ECR_URI/$BACKEND_REPO:latest",
            "essential": true,
            "portMappings": [
                {"containerPort": 8001, "protocol": "tcp"}
            ],
            "environment": [
                {"name": "CORS_ORIGINS", "value": "http://$ALB_DNS"},
                {"name": "KNOWLEDGE_DIR", "value": "/app/knowledge"},
                {"name": "CHROMA_DIR", "value": "/app/knowledge/chroma_db"}
            ],
            "secrets": [
                {"name": "ANTHROPIC_API_KEY", "valueFrom": "${SECRET_ARN}:ANTHROPIC_API_KEY::"},
                {"name": "OPENAI_API_KEY", "valueFrom": "${SECRET_ARN}:OPENAI_API_KEY::"},
                {"name": "TAVILY_API_KEY", "valueFrom": "${SECRET_ARN}:TAVILY_API_KEY::"}
            ],
            "mountPoints": [
                {
                    "sourceVolume": "knowledge",
                    "containerPath": "/app/knowledge",
                    "readOnly": false
                }
            ],
            "logConfiguration": {
                "logDriver": "awslogs",
                "options": {
                    "awslogs-group": "$LOG_GROUP",
                    "awslogs-region": "$REGION",
                    "awslogs-stream-prefix": "backend"
                }
            }
        }
    ],
    "volumes": [
        {
            "name": "knowledge",
            "efsVolumeConfiguration": {
                "fileSystemId": "$EFS_ID",
                "rootDirectory": "/",
                "transitEncryption": "ENABLED"
            }
        }
    ]
}
TASKDEF

    aws ecs register-task-definition --cli-input-json file:///tmp/askmura-backend-task.json \
        --region "$REGION" >/dev/null
    log "  Registered backend task definition"

    # Frontend task definition
    cat > /tmp/askmura-frontend-task.json <<TASKDEF
{
    "family": "askmura-frontend",
    "networkMode": "awsvpc",
    "requiresCompatibilities": ["FARGATE"],
    "cpu": "512",
    "memory": "512",
    "executionRoleArn": "$EXEC_ROLE_ARN",
    "containerDefinitions": [
        {
            "name": "frontend",
            "image": "$ECR_URI/$FRONTEND_REPO:latest",
            "essential": true,
            "portMappings": [
                {"containerPort": 80, "protocol": "tcp"}
            ],
            "logConfiguration": {
                "logDriver": "awslogs",
                "options": {
                    "awslogs-group": "$LOG_GROUP",
                    "awslogs-region": "$REGION",
                    "awslogs-stream-prefix": "frontend"
                }
            }
        }
    ]
}
TASKDEF

    aws ecs register-task-definition --cli-input-json file:///tmp/askmura-frontend-task.json \
        --region "$REGION" >/dev/null
    log "  Registered frontend task definition"
}

# ------------------------------------------------------------------
# 11. ECS Services
# ------------------------------------------------------------------
create_services() {
    log "Creating ECS services..."

    # Backend service
    EXISTING_BE=$(aws ecs describe-services --cluster "$CLUSTER" --services "askmura-backend" \
        --region "$REGION" --query "services[?status=='ACTIVE'].serviceName" --output text 2>/dev/null)

    if [ "$EXISTING_BE" = "askmura-backend" ]; then
        log "  Backend service already exists — forcing new deployment"
        aws ecs update-service --cluster "$CLUSTER" --service "askmura-backend" \
            --force-new-deployment --region "$REGION" >/dev/null
    else
        aws ecs create-service --cluster "$CLUSTER" \
            --service-name "askmura-backend" \
            --task-definition "askmura-backend" \
            --desired-count 1 \
            --launch-type FARGATE \
            --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_1,$SUBNET_2],securityGroups=[$SG_ECS_ID],assignPublicIp=ENABLED}" \
            --load-balancers "targetGroupArn=$BE_TG_ARN,containerName=backend,containerPort=8001" \
            --region "$REGION" >/dev/null
        log "  Created backend service"
    fi

    # Frontend service
    EXISTING_FE=$(aws ecs describe-services --cluster "$CLUSTER" --services "askmura-frontend" \
        --region "$REGION" --query "services[?status=='ACTIVE'].serviceName" --output text 2>/dev/null)

    if [ "$EXISTING_FE" = "askmura-frontend" ]; then
        log "  Frontend service already exists — forcing new deployment"
        aws ecs update-service --cluster "$CLUSTER" --service "askmura-frontend" \
            --force-new-deployment --region "$REGION" >/dev/null
    else
        aws ecs create-service --cluster "$CLUSTER" \
            --service-name "askmura-frontend" \
            --task-definition "askmura-frontend" \
            --desired-count 1 \
            --launch-type FARGATE \
            --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_1,$SUBNET_2],securityGroups=[$SG_ECS_ID],assignPublicIp=ENABLED}" \
            --load-balancers "targetGroupArn=$FE_TG_ARN,containerName=frontend,containerPort=80" \
            --region "$REGION" >/dev/null
        log "  Created frontend service"
    fi
}

# ------------------------------------------------------------------
# 12. Seed EFS with Knowledge Data
# ------------------------------------------------------------------
seed_efs() {
    log "Seeding EFS with knowledge data..."

    # Check if knowledge directory has data
    if [ ! -d "$KNOWLEDGE_DIR" ]; then
        warn "  No knowledge/ directory found at $KNOWLEDGE_DIR — skipping seed"
        return
    fi

    # Use a temporary ECS task to copy data to EFS
    # We'll create a one-off task that mounts EFS and copies data
    cat > /tmp/askmura-seed-task.json <<TASKDEF
{
    "family": "askmura-seed",
    "networkMode": "awsvpc",
    "requiresCompatibilities": ["FARGATE"],
    "cpu": "256",
    "memory": "512",
    "executionRoleArn": "$EXEC_ROLE_ARN",
    "taskRoleArn": "$TASK_ROLE_ARN",
    "containerDefinitions": [
        {
            "name": "seed",
            "image": "$ECR_URI/$BACKEND_REPO:latest",
            "essential": true,
            "command": ["sh", "-c", "if [ ! -f /mnt/efs/common_answers.yaml ]; then cp -r /app/knowledge/* /mnt/efs/ && echo 'Seeded EFS'; else echo 'EFS already has data'; fi"],
            "mountPoints": [
                {
                    "sourceVolume": "knowledge",
                    "containerPath": "/mnt/efs",
                    "readOnly": false
                }
            ],
            "logConfiguration": {
                "logDriver": "awslogs",
                "options": {
                    "awslogs-group": "$LOG_GROUP",
                    "awslogs-region": "$REGION",
                    "awslogs-stream-prefix": "seed"
                }
            }
        }
    ],
    "volumes": [
        {
            "name": "knowledge",
            "efsVolumeConfiguration": {
                "fileSystemId": "$EFS_ID",
                "rootDirectory": "/",
                "transitEncryption": "ENABLED"
            }
        }
    ]
}
TASKDEF

    aws ecs register-task-definition --cli-input-json file:///tmp/askmura-seed-task.json \
        --region "$REGION" >/dev/null

    SEED_TASK_ARN=$(aws ecs run-task --cluster "$CLUSTER" \
        --task-definition "askmura-seed" \
        --launch-type FARGATE \
        --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_1],securityGroups=[$SG_ECS_ID],assignPublicIp=ENABLED}" \
        --query 'tasks[0].taskArn' --output text --region "$REGION")

    log "  Seed task started: $SEED_TASK_ARN"
    log "  (Data will be copied in the background — backend will use it once available)"
}

# ------------------------------------------------------------------
# 13. Wait & Print Summary
# ------------------------------------------------------------------
wait_and_summarize() {
    echo ""
    log "Waiting for services to stabilize..."
    log "  (This may take 2-5 minutes for containers to start)"

    # Wait for backend service
    for i in $(seq 1 60); do
        RUNNING=$(aws ecs describe-services --cluster "$CLUSTER" --services "askmura-backend" \
            --region "$REGION" --query 'services[0].runningCount' --output text 2>/dev/null)
        if [ "$RUNNING" = "1" ]; then
            log "  Backend service is running"
            break
        fi
        if [ "$i" = "60" ]; then
            warn "  Backend service still starting — check ECS console for details"
        fi
        sleep 5
    done

    # Wait for frontend service
    for i in $(seq 1 60); do
        RUNNING=$(aws ecs describe-services --cluster "$CLUSTER" --services "askmura-frontend" \
            --region "$REGION" --query 'services[0].runningCount' --output text 2>/dev/null)
        if [ "$RUNNING" = "1" ]; then
            log "  Frontend service is running"
            break
        fi
        if [ "$i" = "60" ]; then
            warn "  Frontend service still starting — check ECS console for details"
        fi
        sleep 5
    done

    echo ""
    echo "=============================================="
    echo -e "${GREEN}  AskMura — Deployed!${NC}"
    echo "=============================================="
    echo ""
    echo "  URL:     http://$ALB_DNS/"
    echo "  Health:  http://$ALB_DNS/health"
    echo "  Debug:   http://$ALB_DNS/debug/"
    echo "  Admin:   http://$ALB_DNS/admin/"
    echo ""
    echo "  Useful commands:"
    echo "    View logs:     aws logs tail $LOG_GROUP --follow --region $REGION"
    echo "    Update deploy: ./deploy/update.sh"
    echo "    ECS console:   https://$REGION.console.aws.amazon.com/ecs/v2/clusters/$CLUSTER"
    echo ""
}

# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------
main() {
    echo ""
    echo "=========================================="
    echo "  AskMura — AWS ECS Fargate Deployment"
    echo "=========================================="
    echo ""

    check_prerequisites
    create_ecr_repos
    build_and_push
    setup_networking
    setup_efs
    setup_secrets
    setup_iam
    setup_logging
    setup_cluster
    setup_alb
    register_task_definitions
    create_services
    seed_efs
    wait_and_summarize
}

main "$@"
