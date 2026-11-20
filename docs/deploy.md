# Deploying develop to Amazon ECS

`.github/workflows/deploy-develop.yml` runs on every push to `develop` (and by hand from the Actions tab). It:

1. runs the full CI workflow (lint, unit, e2e against Postgres 16, build, OpenAPI);
2. builds the Docker image and pushes it to ECR, tagged with the commit SHA;
3. copies the task definition the ECS service runs now, swaps in the new image and registers it;
4. runs `node dist-openapi/scripts/migrate.js` as a one-off task with that task definition, in the service's subnets and security groups, and stops if it fails, so the service is never rolled onto a schema it does not have;
5. updates the service and waits until it is stable. If the deployment circuit breaker rolls back, the job fails.

The workflow changes only the image. Roles, environment variables, secrets, CPU and memory stay in the task definition you manage in AWS.

The workflow does not create any AWS resources. Everything below must exist first.

For nonprod (`https://now-dev.raahi.io`), all of it already exists. It is defined in Terraform in the RAAHI infra folder, `infra/terraform/ecs-nonprod/now_api.tf`. `terraform output now_github_environment_variables` prints the GitHub variables. The task definition there is the source of truth: the workflow copies its latest revision and only swaps the image, so after changing an env var, `terraform apply` and then re-run this workflow. The service is created at 0 tasks; the first successful deploy scales it to 1.

## AWS resources

**ECR repository** (for example `raahi-now-api`): immutable tags, scan on push.

**ECS cluster and service**:
- Fargate, `awsvpc` networking, behind an Application Load Balancer.
- Target group health check on `GET /v1/health` (port 3000).
- Deployment circuit breaker enabled with rollback.

**Task definition**, with one container named `api` (or set `ECS_CONTAINER_NAME`):
- Port mapping 3000.
- Log driver `awslogs`.
- Execution role: ECR pull, CloudWatch Logs, and `secretsmanager:GetSecretValue` on the secrets below.
- Task role: S3 read/write on `S3_BUCKET` and `ses:SendEmail` from `SES_FROM`.

Environment variables (see `.env.example`). The ones that matter in production:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production`. The image sets this; keep it. Anything else uses the log-only mailer and serves `/v1/docs`. |
| `TRUST_PROXY` | `1` behind one ALB, or every client shares the ALB's IP for rate limits. |
| `S3_BUCKET`, `S3_REGION`, `SES_FROM`, `SES_REGION`, `FIREBASE_PROJECT_ID`, `MEDIA_BASE_URL`, `JOBS_ENABLED` | per environment |

Secrets come from Secrets Manager through the container definition's `secrets` field, never plain environment variables:
- `DATABASE_URL`
- `DATABASE_PUBLIC_URL`
- `CLAIM_CODE_SECRET` and `MANAGE_TOKEN_SECRET` (32 or more characters)
- `DEVICE_HASH_SALT`

**Database:** PostgreSQL 16, reachable from the service's security group. The pipeline creates the tables, but the read-only login role for `DATABASE_PUBLIC_URL` is created once by hand; see README, "Database roles".

## GitHub to AWS (OIDC, no stored keys)

1. In IAM, add the identity provider `token.actions.githubusercontent.com`, with audience `sts.amazonaws.com`, once per account.
2. Create a deploy role whose trust policy allows only this repository's `develop` environment:

```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "repo:<OWNER>/<REPO>:environment:develop"
    }
  }
}
```

3. Give the role this permissions policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*" },
    {
      "Effect": "Allow",
      "Action": ["ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart",
                 "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage"],
      "Resource": "arn:aws:ecr:<REGION>:<ACCOUNT_ID>:repository/<ECR_REPOSITORY>"
    },
    {
      "Effect": "Allow",
      "Action": ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["ecs:DescribeServices", "ecs:UpdateService"],
      "Resource": "arn:aws:ecs:<REGION>:<ACCOUNT_ID>:service/<ECS_CLUSTER>/<ECS_SERVICE>"
    },
    {
      "Effect": "Allow",
      "Action": ["ecs:RunTask", "ecs:DescribeTasks"],
      "Resource": "*",
      "Condition": { "ArnEquals": { "ecs:cluster": "arn:aws:ecs:<REGION>:<ACCOUNT_ID>:cluster/<ECS_CLUSTER>" } }
    },
    {
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": ["<TASK_EXECUTION_ROLE_ARN>", "<TASK_ROLE_ARN>"],
      "Condition": { "StringEquals": { "iam:PassedToService": "ecs-tasks.amazonaws.com" } }
    }
  ]
}
```

## GitHub settings

Create a GitHub environment named `develop` (Settings, then Environments) and add these **variables**. They are not secrets, because no keys are stored.

| Variable | Example |
| --- | --- |
| `AWS_REGION` | `ap-south-1` |
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::123456789012:role/raahi-now-github-deploy-develop` |
| `ECR_REPOSITORY` | `raahi-now-api` |
| `ECS_CLUSTER` | `raahi-now-develop` |
| `ECS_SERVICE` | `raahi-now-api` |
| `ECS_CONTAINER_NAME` | optional, defaults to `api` |

A run with any required variable missing fails at its first step and names what is missing.
