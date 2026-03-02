# Gigalixir Deploy Action

A GitHub Action for deploying applications to [Gigalixir](https://gigalixir.com), the Platform-as-a-Service for Elixir.

## Usage

```yaml
- uses: gigalixir/gigalixir-action@v1
  with:
    gigalixir_email: ${{ secrets.GIGALIXIR_EMAIL }}
    gigalixir_api_key: ${{ secrets.GIGALIXIR_API_KEY }}
    app_name: my-app-name
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `gigalixir_email` | Yes | | Your Gigalixir account email |
| `gigalixir_api_key` | Yes | | Your Gigalixir API key |
| `app_name` | Yes | | The name of your Gigalixir app |
| `action` | No | `deploy` | Action to perform: `deploy`, `create`, `destroy`, `create_deploy`, or `scale` |
| `git_ref` | No | `${{ github.sha }}` | The git ref (commit, branch, tag) to deploy |
| `cloud` | No | | Cloud provider for new apps (`gcp` or `aws`) |
| `region` | No | | Region for new apps (e.g., `us-east-1`, `us-central1`) |
| `stack` | No | | Stack for new apps (e.g., `gigalixir-20`) |
| `database_size` | No | | Database size: `free`, `0.6`, `1.7`, `4`, `8`, `16`, `32`, `48`, `64`, `96` |
| `database_version` | No | | PostgreSQL major version (e.g., `16`, `15`, `14`) |
| `copy_config_from` | No | | App name to copy environment config from |
| `github_deployments` | No | `false` | Create GitHub Deployment records for tracking |
| `github_environment` | No | `app_name` | GitHub Environment name for deployment tracking |
| `app_subfolder` | No | | Subfolder to deploy for monorepo/subtree setups |
| `clean_build_cache` | No | `false` | Clear the build cache before building |
| `deploy_timeout` | No | `0` | Max seconds to wait for deployment rollout to complete (0 = skip) |
| `replicas` | No | | Number of replicas to run (used with `action: scale`) |
| `size` | No | | Size of each replica between 0.5 and 128 (used with `action: scale`) |
| `config_*` | No | | Config variables to set before deploy (see below) |

## Outputs

| Output | Description |
|--------|-------------|
| `deploy_status` | Status of the action (`success` or `failure`) |
| `app_name` | The name of the Gigalixir app |
| `app_url` | The URL of the deployed app |
| `database_url` | The DATABASE_URL if a database was created |

## Actions

### `deploy` (default)

Deploys code to an existing Gigalixir app by pushing to the git remote.

### `create`

Creates a new Gigalixir app with optional database and config. Useful for preview environments.

### `destroy`

Destroys a Gigalixir app and its associated resources. Useful for cleaning up preview environments.

### `create_deploy`

Creates an app (if it doesn't exist) and deploys code in one step. Ideal for PR preview environments.

### `scale`

Scales an app's replicas and/or size. Useful for scaling preview environments down to 0 replicas to save costs, or back up when needed.

## Setup

### 1. Get Your Gigalixir API Key

If you don't have an API key, generate one using the Gigalixir CLI:

```bash
gigalixir account:api_key:reset
```

Or retrieve your existing key from `~/.netrc` after logging in.

### 2. Add Secrets to Your Repository

1. Go to your GitHub repository
2. Navigate to **Settings** > **Secrets and variables** > **Actions**
3. Add the following secrets:
   - `GIGALIXIR_EMAIL` - Your Gigalixir account email
   - `GIGALIXIR_API_KEY` - Your Gigalixir API key

### 3. Create a Workflow

Create `.github/workflows/deploy.yml` in your repository:

```yaml
name: Deploy to Gigalixir

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Required for git push

      - uses: gigalixir/gigalixir-action@v1
        with:
          gigalixir_email: ${{ secrets.GIGALIXIR_EMAIL }}
          gigalixir_api_key: ${{ secrets.GIGALIXIR_API_KEY }}
          app_name: my-app-name
```

## Examples

See the [examples/](examples/) directory for complete workflow files:

- [simple-deploy.yml](examples/simple-deploy.yml) - Basic single app deployment
- [staging-production.yml](examples/staging-production.yml) - Staging and production environments
- [staging-preview-production.yml](examples/staging-preview-production.yml) - With shared preview environment
- [pr-preview-environments.yml](examples/pr-preview-environments.yml) - Unique app per pull request
- [monorepo-subtree-deploy.yml](examples/monorepo-subtree-deploy.yml) - Deploy a subdirectory from a monorepo

### Deploy on Push to Main

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: gigalixir/gigalixir-action@v1
        with:
          gigalixir_email: ${{ secrets.GIGALIXIR_EMAIL }}
          gigalixir_api_key: ${{ secrets.GIGALIXIR_API_KEY }}
          app_name: my-production-app
```

### PR Preview Environments

Create a unique Gigalixir app for each pull request with its own database:

```yaml
name: PR Preview

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

jobs:
  deploy-preview:
    if: github.event.action != 'closed'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: ${{ github.event.pull_request.head.sha }}

      - uses: gigalixir/gigalixir-action@v1
        with:
          gigalixir_email: ${{ secrets.GIGALIXIR_EMAIL }}
          gigalixir_api_key: ${{ secrets.GIGALIXIR_API_KEY }}
          app_name: my-app-pr-${{ github.event.pull_request.number }}
          action: create_deploy
          database_size: free
          copy_config_from: my-app-staging

  cleanup-preview:
    if: github.event.action == 'closed'
    runs-on: ubuntu-latest
    steps:
      - uses: gigalixir/gigalixir-action@v1
        with:
          gigalixir_email: ${{ secrets.GIGALIXIR_EMAIL }}
          gigalixir_api_key: ${{ secrets.GIGALIXIR_API_KEY }}
          app_name: my-app-pr-${{ github.event.pull_request.number }}
          action: destroy
```

### Scale an App

Scale replicas and/or size, for example to scale a preview environment down to 0:

```yaml
- uses: gigalixir/gigalixir-action@v1
  with:
    gigalixir_email: ${{ secrets.GIGALIXIR_EMAIL }}
    gigalixir_api_key: ${{ secrets.GIGALIXIR_API_KEY }}
    app_name: my-app-pr-123
    action: scale
    replicas: "0"
```

### Monorepo / Subtree Deploy

Deploy an app that lives in a subdirectory using `git subtree push`:

```yaml
- uses: gigalixir/gigalixir-action@v1
  with:
    gigalixir_email: ${{ secrets.GIGALIXIR_EMAIL }}
    gigalixir_api_key: ${{ secrets.GIGALIXIR_API_KEY }}
    app_name: my-app
    app_subfolder: apps/web
```

### Set Config Variables Before Deploy

Any input prefixed with `config_` will be set as a Gigalixir environment variable (with the prefix stripped) before deploying. Config is applied with `avoid_restart=true` since the deploy handles the restart.

```yaml
- uses: gigalixir/gigalixir-action@v1
  with:
    gigalixir_email: ${{ secrets.GIGALIXIR_EMAIL }}
    gigalixir_api_key: ${{ secrets.GIGALIXIR_API_KEY }}
    app_name: my-app
    config_MIX_ENV: prod
    config_SECRET_KEY_BASE: ${{ secrets.SECRET_KEY_BASE }}
    config_DATABASE_POOL_SIZE: "10"
```

### Wait for Deployment Rollout

Wait for the deployment to finish rolling out before continuing. This is useful for triggering downstream actions (e.g., Slack notifications) only after the deployment is actually live:

```yaml
- uses: gigalixir/gigalixir-action@v1
  id: deploy
  with:
    gigalixir_email: ${{ secrets.GIGALIXIR_EMAIL }}
    gigalixir_api_key: ${{ secrets.GIGALIXIR_API_KEY }}
    app_name: my-app
    deploy_timeout: "90"

- uses: slackapi/slack-github-action@v2
  if: always()
  with:
    webhook: ${{ secrets.SLACK_WEBHOOK_URL }}
    webhook-type: incoming-webhook
    payload: |
      text: "Deploy ${{ steps.deploy.outputs.deploy_status }}: ${{ steps.deploy.outputs.app_url }}"
```

### Deploy to Staging and Production

```yaml
name: Deploy

on:
  push:
    branches: [main, develop]

jobs:
  deploy-staging:
    if: github.ref_name == 'develop'
    runs-on: ubuntu-latest
    environment:
      name: staging
      url: https://my-app-staging.gigalixirapp.com
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: gigalixir/gigalixir-action@v1
        with:
          gigalixir_email: ${{ secrets.GIGALIXIR_EMAIL }}
          gigalixir_api_key: ${{ secrets.GIGALIXIR_API_KEY }}
          app_name: my-app-staging

  deploy-production:
    if: github.ref_name == 'main'
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://my-app.gigalixirapp.com
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: gigalixir/gigalixir-action@v1
        with:
          gigalixir_email: ${{ secrets.GIGALIXIR_EMAIL }}
          gigalixir_api_key: ${{ secrets.GIGALIXIR_API_KEY }}
          app_name: my-app-prod
```

## How It Works

This action supports multiple operations:

**Deploy:** Pushes code to `git.gigalixir.com` which triggers a build and deployment.

**Create:** Calls the Gigalixir API to create a new app, optionally with a database and copied config.

**Destroy:** Calls the Gigalixir API to delete an app and its associated resources.

**Scale:** Calls the Gigalixir API to change the number of replicas and/or the size of each replica.

## GitHub Deployments Integration

Enable `github_deployments: true` to create deployment records in GitHub's UI. This provides:

- Deployment history visible in the repository's "Deployments" section
- Status updates (in_progress → success/failure)
- Direct links to your deployed app
- Integration with GitHub's environment protection rules

```yaml
- uses: gigalixir/gigalixir-action@v1
  with:
    gigalixir_email: ${{ secrets.GIGALIXIR_EMAIL }}
    gigalixir_api_key: ${{ secrets.GIGALIXIR_API_KEY }}
    app_name: my-app
    github_deployments: true
    github_environment: production
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Note:** GitHub Deployments require `deployments: write` permission and are not available for private repositories on the GitHub Free plan. See [GitHub's documentation](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment) for details.

## Migrating from gigalixir-action

If you're migrating from the original [gigalixir-action](https://github.com/mhanberg/gigalixir-action), the old input names are supported as deprecated aliases. Your existing workflow will continue to work, but you'll see deprecation warnings in the Actions UI.

| Old Input | New Input |
|-----------|-----------|
| `GIGALIXIR_USERNAME` | `gigalixir_email` |
| `GIGALIXIR_PASSWORD` | `gigalixir_api_key` |
| `GIGALIXIR_APP` | `app_name` |
| `APP_SUBFOLDER` | `app_subfolder` |
| `GIGALIXIR_CLEAN` | `clean_build_cache` |

**Before (gigalixir-action):**

```yaml
- uses: mhanberg/gigalixir-action@v1
  with:
    GIGALIXIR_USERNAME: ${{ secrets.GIGALIXIR_EMAIL }}
    GIGALIXIR_PASSWORD: ${{ secrets.GIGALIXIR_API_KEY }}
    GIGALIXIR_APP: my-app
```

**After (gigalixir-action):**

```yaml
- uses: gigalixir/gigalixir-action@v1
  with:
    gigalixir_email: ${{ secrets.GIGALIXIR_EMAIL }}
    gigalixir_api_key: ${{ secrets.GIGALIXIR_API_KEY }}
    app_name: my-app
```

**Note:** The `MIGRATIONS` and `SSH_PRIVATE_KEY` inputs are not supported in v1. If your workflow uses SSH-based migrations, use `@v0` which preserves the original gigalixir-action behavior:

```yaml
- uses: gigalixir/gigalixir-action@v0
  with:
    GIGALIXIR_USERNAME: ${{ secrets.GIGALIXIR_EMAIL }}
    GIGALIXIR_PASSWORD: ${{ secrets.GIGALIXIR_API_KEY }}
    GIGALIXIR_APP: my-app
    MIGRATIONS: true
    SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
```

If you provide `MIGRATIONS` or `SSH_PRIVATE_KEY` to `@v1`, the action will fail with an error directing you to `@v0`.

## Security

- Always store your API key as a GitHub Secret, never in your workflow file
- The action automatically cleans up credentials after execution
- API keys are masked in workflow logs

## Troubleshooting

### "Authentication failed"

- Verify your `GIGALIXIR_EMAIL` and `GIGALIXIR_API_KEY` secrets are correct
- Ensure your API key hasn't been regenerated since adding it to GitHub Secrets

### "App not found"

- Check that the `app_name` matches your Gigalixir app exactly
- Verify you have permission to deploy to this app

### "fetch-depth" Warning

Always use `fetch-depth: 0` with `actions/checkout` to ensure the full git history is available for the push:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
```

## Development

All dev commands run inside Docker via `make`. No local Node.js install required.

```bash
make test            # Run Jest tests
make lint            # Run ESLint
make format          # Format with Prettier
make format-check    # Check formatting without writing
make build-action    # Compile TypeScript to dist/
make all             # Format, lint, test, and build
make shell           # Open interactive shell in dev container
make install         # Install/update npm dependencies
make build           # Build the dev Docker image
make clean           # Remove containers, images, and local artifacts
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- [Gigalixir Documentation](https://docs.gigalixir.com/)
- [Report Issues](https://github.com/gigalixir/gigalixir-action/issues)
