import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fs from 'fs'
import * as https from 'https'

const GIGALIXIR_GIT_HOST = 'git.gigalixir.com'
const GIGALIXIR_API_HOST = 'api.gigalixir.com'
const GITHUB_API_HOST = 'api.github.com'

type ActionType = 'deploy' | 'create' | 'destroy' | 'create_deploy' | 'scale'
type DeploymentState =
  | 'pending'
  | 'in_progress'
  | 'success'
  | 'failure'
  | 'error'

interface GigalixirApiResponse {
  data?: Record<string, unknown>
  errors?: Record<string, string[]>
}

interface GigalixirPod {
  name: string
  sha: string
  status: string
  version: string
}

interface GigalixirAppStatus {
  data: {
    pods: GigalixirPod[]
    replicas_desired: number
  }
}

interface GitHubDeployment {
  id: number
  url: string
}

function getInputWithFallback(name: string, deprecatedName: string): string {
  const value = core.getInput(name)
  if (value) return value

  const fallback = core.getInput(deprecatedName)
  if (fallback) {
    core.warning(
      `Input '${deprecatedName}' is deprecated. Use '${name}' instead.`
    )
    return fallback
  }

  return ''
}

export async function run(): Promise<void> {
  const email = getInputWithFallback('gigalixir_email', 'GIGALIXIR_USERNAME')
  const apiKey = getInputWithFallback('gigalixir_api_key', 'GIGALIXIR_PASSWORD')
  const appName = getInputWithFallback('app_name', 'GIGALIXIR_APP')
  const action = (core.getInput('action') || 'deploy') as ActionType

  if (!email || !apiKey || !appName) {
    if (!email) {
      core.setFailed("Input required and not supplied: 'gigalixir_email'")
    } else if (!apiKey) {
      core.setFailed("Input required and not supplied: 'gigalixir_api_key'")
    } else {
      core.setFailed("Input required and not supplied: 'app_name'")
    }
    return
  }

  // Check for unsupported inputs from the original gigalixir-action
  const migrations = core.getInput('MIGRATIONS')
  const sshPrivateKey = core.getInput('SSH_PRIVATE_KEY')
  if (
    migrations.toLowerCase() === 'true' ||
    migrations === '1' ||
    sshPrivateKey
  ) {
    core.setFailed(
      'The MIGRATIONS and SSH_PRIVATE_KEY inputs are not supported in this version. ' +
        'Use gigalixir/gigalixir-action@v0 for SSH-based migration support, ' +
        'or run migrations as a separate step in your deployment pipeline.'
    )
    return
  }

  const useGitHubDeployments = core.getInput('github_deployments') === 'true'
  const githubEnvironment = core.getInput('github_environment') || appName

  // Mask the API key so it doesn't appear in logs
  core.setSecret(apiKey)

  const appUrl = `https://${appName}.gigalixirapp.com`
  let deploymentId: number | null = null

  try {
    // Create GitHub deployment if enabled
    if (useGitHubDeployments && action !== 'destroy') {
      deploymentId = await createGitHubDeployment(githubEnvironment, appUrl)
      if (deploymentId) {
        await updateDeploymentStatus(deploymentId, 'in_progress', appUrl)
      }
    }

    const deployTimeout = parseInt(core.getInput('deploy_timeout') || '0', 10)

    switch (action) {
      case 'deploy':
        await setAppConfig(email, apiKey, appName)
        await handleDeploy(email, apiKey, appName)
        break
      case 'create':
        await handleCreate(email, apiKey, appName)
        break
      case 'destroy':
        await handleDestroy(email, apiKey, appName)
        break
      case 'create_deploy':
        await handleCreate(email, apiKey, appName)
        await setAppConfig(email, apiKey, appName)
        await handleDeploy(email, apiKey, appName)
        break
      case 'scale':
        await handleScale(email, apiKey, appName)
        break
      default:
        throw new Error(`Unknown action: ${action}`)
    }

    // Wait for deployment rollout if timeout is set
    if (
      deployTimeout > 0 &&
      (action === 'deploy' || action === 'create_deploy')
    ) {
      const sha = process.env.GITHUB_SHA || ''
      await waitForDeployment(email, apiKey, appName, sha, deployTimeout)
    }

    core.setOutput('deploy_status', 'success')
    core.setOutput('app_name', appName)
    core.setOutput('app_url', appUrl)

    // Update GitHub deployment status to success
    if (deploymentId) {
      await updateDeploymentStatus(deploymentId, 'success', appUrl)
    }
  } catch (error) {
    core.setOutput('deploy_status', 'failure')

    // Update GitHub deployment status to failure
    if (deploymentId) {
      await updateDeploymentStatus(deploymentId, 'failure', appUrl)
    }

    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unexpected error occurred')
    }
  } finally {
    // Clean up credentials
    await cleanupGitCredentials()
  }
}

export async function setAppConfig(
  email: string,
  apiKey: string,
  appName: string
): Promise<void> {
  const prefix = 'INPUT_CONFIG_'
  const configs: Record<string, string> = {}

  for (const [envKey, envValue] of Object.entries(process.env)) {
    if (envKey.startsWith(prefix) && envValue !== undefined) {
      const configKey = envKey.substring(prefix.length)
      configs[configKey] = envValue
    }
  }

  if (Object.keys(configs).length === 0) {
    return
  }

  core.info(`Setting ${Object.keys(configs).length} config variable(s)...`)

  const encodedAppName = encodeURIComponent(appName)
  await gigalixirApiRequest(
    email,
    apiKey,
    'POST',
    `/api/apps/${encodedAppName}/configs`,
    { configs, avoid_restart: true },
    201
  )

  core.info('Config variables set successfully')
}

async function handleDeploy(
  email: string,
  apiKey: string,
  appName: string
): Promise<void> {
  const gitRef = core.getInput('git_ref') || process.env.GITHUB_SHA || 'HEAD'
  const appSubfolder = core.getInput('app_subfolder')
  const cleanBuildCache =
    (getInputWithFallback('clean_build_cache', 'GIGALIXIR_CLEAN') ||
      'false') === 'true'

  core.info(`Deploying to Gigalixir app: ${appName}`)
  core.info(`Git ref: ${gitRef}`)
  if (appSubfolder) {
    core.info(`App subfolder: ${appSubfolder}`)
  }
  if (cleanBuildCache) {
    core.info('Clean build cache enabled')
  }

  // Configure git credentials
  await configureGitCredentials(email, apiKey)

  // Add Gigalixir remote
  const remoteUrl = `https://${GIGALIXIR_GIT_HOST}/${appName}.git/`
  await addGigalixirRemote(remoteUrl)

  // Push to Gigalixir
  if (appSubfolder) {
    await subtreePushToGigalixir(appSubfolder, cleanBuildCache)
  } else {
    await pushToGigalixir(gitRef, cleanBuildCache)
  }

  core.info('Deployment successful!')
}

async function handleCreate(
  email: string,
  apiKey: string,
  appName: string
): Promise<void> {
  core.info(`Creating Gigalixir app: ${appName}`)

  const cloud = core.getInput('cloud')
  const region = core.getInput('region')
  const stack = core.getInput('stack')
  const databaseSize = core.getInput('database_size')
  const databaseVersion = core.getInput('database_version')
  const copyConfigFrom = core.getInput('copy_config_from')

  // Check if app already exists
  const appExists = await checkAppExists(email, apiKey, appName)
  if (appExists) {
    core.info(`App ${appName} already exists, skipping creation`)
  } else {
    // Create the app
    await createApp(email, apiKey, appName, { cloud, region, stack })
    core.info(`App ${appName} created successfully`)
  }

  // Create database if requested
  if (databaseSize) {
    core.info(`Creating database with size: ${databaseSize}`)
    const dbUrl = await createDatabase(
      email,
      apiKey,
      appName,
      databaseSize,
      databaseVersion,
      cloud,
      region
    )
    if (dbUrl) {
      core.setOutput('database_url', dbUrl)
    }
    core.info('Database created successfully')
  }

  // Copy config from another app if requested
  if (copyConfigFrom) {
    core.info(`Copying config from: ${copyConfigFrom}`)
    await copyConfig(email, apiKey, appName, copyConfigFrom)
    core.info('Config copied successfully')
  }
}

async function handleDestroy(
  email: string,
  apiKey: string,
  appName: string
): Promise<void> {
  core.info(`Destroying Gigalixir app: ${appName}`)

  // Check if app exists before trying to delete
  const appExists = await checkAppExists(email, apiKey, appName)
  if (!appExists) {
    core.info(`App ${appName} does not exist, nothing to destroy`)
    return
  }

  // Scale down to 0 replicas before deleting
  core.info(`Scaling ${appName} to 0 replicas...`)
  const encodedAppName = encodeURIComponent(appName)
  await gigalixirApiRequest(
    email,
    apiKey,
    'PUT',
    `/api/apps/${encodedAppName}/scale`,
    { replicas: 0 }
  )

  // Delete the app (this also deletes associated databases)
  await deleteApp(email, apiKey, appName)
  core.info(`App ${appName} destroyed successfully`)
}

async function handleScale(
  email: string,
  apiKey: string,
  appName: string
): Promise<void> {
  const replicasInput = core.getInput('replicas')
  const sizeInput = core.getInput('size')

  if (!replicasInput && !sizeInput) {
    throw new Error(
      'At least one of replicas or size must be provided for scale action'
    )
  }

  const body: Record<string, number> = {}
  if (replicasInput) {
    body.replicas = parseInt(replicasInput, 10)
  }
  if (sizeInput) {
    body.size = parseFloat(sizeInput)
  }

  core.info(`Scaling Gigalixir app: ${appName}`)
  if (body.replicas !== undefined) {
    core.info(`Replicas: ${body.replicas}`)
  }
  if (body.size !== undefined) {
    core.info(`Size: ${body.size}`)
  }

  const encodedAppName = encodeURIComponent(appName)
  await gigalixirApiRequest(
    email,
    apiKey,
    'PUT',
    `/api/apps/${encodedAppName}/scale`,
    body
  )

  core.info('Scale operation successful!')
}

// GitHub Deployments API Functions

async function createGitHubDeployment(
  environment: string,
  _environmentUrl: string
): Promise<number | null> {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPOSITORY
  const sha = process.env.GITHUB_SHA

  if (!token || !repo || !sha) {
    core.warning(
      'GitHub Deployments: Missing GITHUB_TOKEN, GITHUB_REPOSITORY, or GITHUB_SHA'
    )
    return null
  }

  core.info(`Creating GitHub deployment for environment: ${environment}`)

  try {
    const response = await githubApiRequest<GitHubDeployment>(
      token,
      'POST',
      `/repos/${repo}/deployments`,
      {
        ref: sha,
        environment,
        auto_merge: false,
        required_contexts: [], // Skip status checks for deployment
        description: `Deploying to ${environment}`,
        production_environment: environment === 'production'
      }
    )

    if (response && response.id) {
      core.info(`GitHub deployment created: ${response.id}`)
      return response.id
    }
  } catch (error) {
    core.warning(
      `Failed to create GitHub deployment: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }

  return null
}

async function updateDeploymentStatus(
  deploymentId: number,
  state: DeploymentState,
  environmentUrl: string
): Promise<void> {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPOSITORY

  if (!token || !repo) {
    return
  }

  try {
    await githubApiRequest(
      token,
      'POST',
      `/repos/${repo}/deployments/${deploymentId}/statuses`,
      {
        state,
        environment_url: environmentUrl,
        description: getStatusDescription(state),
        auto_inactive: true
      }
    )
    core.info(`GitHub deployment status updated: ${state}`)
  } catch (error) {
    core.warning(
      `Failed to update deployment status: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

function getStatusDescription(state: DeploymentState): string {
  switch (state) {
    case 'pending':
      return 'Deployment is pending'
    case 'in_progress':
      return 'Deployment in progress'
    case 'success':
      return 'Deployment successful'
    case 'failure':
      return 'Deployment failed'
    case 'error':
      return 'Deployment error'
    default:
      return 'Unknown status'
  }
}

async function githubApiRequest<T>(
  token: string,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: GITHUB_API_HOST,
      port: 443,
      path,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'GigalixirGitHubAction/1.0',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(data ? (JSON.parse(data) as T) : null)
          } catch {
            resolve(null)
          }
        } else {
          reject(
            new Error(`GitHub API request failed: ${res.statusCode} - ${data}`)
          )
        }
      })
    })

    req.on('error', (error) => {
      reject(new Error(`GitHub API request error: ${error.message}`))
    })

    if (body) {
      req.write(JSON.stringify(body))
    }
    req.end()
  })
}

// Gigalixir API Functions

async function checkAppExists(
  email: string,
  apiKey: string,
  appName: string
): Promise<boolean> {
  try {
    await gigalixirApiRequest(
      email,
      apiKey,
      'GET',
      `/api/apps/${encodeURIComponent(appName)}`
    )
    return true
  } catch {
    return false
  }
}

async function createApp(
  email: string,
  apiKey: string,
  appName: string,
  options: { cloud?: string; region?: string; stack?: string }
): Promise<void> {
  const body: Record<string, string> = { unique_name: appName }
  if (options.cloud) body.cloud = options.cloud
  if (options.region) body.region = options.region
  if (options.stack) body.stack = options.stack

  await gigalixirApiRequest(email, apiKey, 'POST', '/api/apps', body, 201)
}

async function deleteApp(
  email: string,
  apiKey: string,
  appName: string
): Promise<void> {
  await gigalixirApiRequest(
    email,
    apiKey,
    'DELETE',
    `/api/apps/${encodeURIComponent(appName)}`
  )
}

async function createDatabase(
  email: string,
  apiKey: string,
  appName: string,
  size: string,
  version?: string,
  cloud?: string,
  region?: string
): Promise<string | null> {
  const encodedAppName = encodeURIComponent(appName)

  if (size === 'free') {
    // Create free database
    const response = await gigalixirApiRequest(
      email,
      apiKey,
      'POST',
      `/api/apps/${encodedAppName}/free_databases`,
      {},
      201
    )
    return (response.data?.url as string) || null
  } else {
    // Create paid database
    const body: Record<string, unknown> = { size: parseFloat(size) }
    if (version) body.version = `POSTGRES_${version}`
    if (cloud) body.cloud = cloud
    if (region) body.region = region

    const response = await gigalixirApiRequest(
      email,
      apiKey,
      'POST',
      `/api/apps/${encodedAppName}/databases`,
      body,
      201
    )
    return (response.data?.url as string) || null
  }
}

async function copyConfig(
  email: string,
  apiKey: string,
  destAppName: string,
  sourceAppName: string
): Promise<void> {
  await gigalixirApiRequest(
    email,
    apiKey,
    'POST',
    `/api/apps/${encodeURIComponent(destAppName)}/configs/copy`,
    { from: sourceAppName }
  )
}

async function gigalixirApiRequest(
  email: string,
  apiKey: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  expectedStatus: number = 200
): Promise<GigalixirApiResponse> {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(
      `${encodeURIComponent(email)}:${encodeURIComponent(apiKey)}`
    ).toString('base64')

    const options: https.RequestOptions = {
      hostname: GIGALIXIR_API_HOST,
      port: 443,
      path,
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        'User-Agent': 'GigalixirGitHubAction/1.0'
      }
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        if (res.statusCode === expectedStatus) {
          try {
            const json = data ? JSON.parse(data) : {}
            resolve(json as GigalixirApiResponse)
          } catch {
            resolve({})
          }
        } else {
          let errorMessage = `API request failed: ${res.statusCode}`
          try {
            const json = JSON.parse(data) as GigalixirApiResponse
            if (json.errors) {
              const errorDetails = Object.entries(json.errors)
                .map(([key, msgs]) => `${key}: ${msgs.join(', ')}`)
                .join('; ')
              errorMessage += ` - ${errorDetails}`
            }
          } catch {
            if (data) errorMessage += ` - ${data}`
          }
          reject(new Error(errorMessage))
        }
      })
    })

    req.on('error', (error) => {
      reject(new Error(`API request error: ${error.message}`))
    })

    if (body) {
      req.write(JSON.stringify(body))
    }
    req.end()
  })
}

// Deployment Verification

export async function waitForDeployment(
  email: string,
  apiKey: string,
  appName: string,
  sha: string,
  timeoutSeconds: number
): Promise<void> {
  const pollIntervalMs = 10_000
  const startTime = Date.now()
  const timeoutMs = timeoutSeconds * 1000
  const shortSha = sha.substring(0, 7)
  const encodedAppName = encodeURIComponent(appName)

  core.info(
    `Waiting for deployment rollout (sha: ${shortSha}, timeout: ${timeoutSeconds}s)...`
  )

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = (await gigalixirApiRequest(
        email,
        apiKey,
        'GET',
        `/api/apps/${encodedAppName}/status`
      )) as unknown as GigalixirAppStatus

      const pods = response.data?.pods || []
      const replicasDesired = response.data?.replicas_desired || 0

      const healthyNewPods = pods.filter(
        (pod: GigalixirPod) =>
          pod.name.startsWith(appName) &&
          pod.sha === sha &&
          pod.status === 'Healthy'
      )

      if (healthyNewPods.length >= replicasDesired && replicasDesired > 0) {
        core.info(
          `Deployment rollout complete: ${healthyNewPods.length}/${replicasDesired} healthy pods`
        )
        return
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000)
      core.info(
        `Rollout in progress: ${healthyNewPods.length}/${replicasDesired} healthy new pods (${elapsed}s elapsed)`
      )
    } catch (error) {
      const elapsed = Math.round((Date.now() - startTime) / 1000)
      core.warning(
        `Failed to check deployment status (${elapsed}s elapsed): ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  // Timeout: get final status for error message
  let statusSummary = 'Could not retrieve final status'
  try {
    const response = (await gigalixirApiRequest(
      email,
      apiKey,
      'GET',
      `/api/apps/${encodedAppName}/status`
    )) as unknown as GigalixirAppStatus

    const pods = response.data?.pods || []
    const replicasDesired = response.data?.replicas_desired || 0
    const podSummaries = pods.map(
      (pod: GigalixirPod) =>
        `${pod.name} (sha: ${pod.sha.substring(0, 7)}, status: ${pod.status})`
    )
    statusSummary = `replicas_desired: ${replicasDesired}, pods: [${podSummaries.join(', ')}]`
  } catch {
    // Use default statusSummary
  }

  throw new Error(
    `Deployment rollout timed out after ${timeoutSeconds}s. Status: ${statusSummary}`
  )
}

// Git Functions

async function configureGitCredentials(
  email: string,
  apiKey: string
): Promise<void> {
  core.info('Configuring git credentials...')

  // Use git credential store for authentication
  await exec.exec('git', [
    'config',
    '--local',
    'credential.helper',
    'store --file=.git-credentials'
  ])

  // Write credentials to the credential store
  const credentialLine = `https://${encodeURIComponent(email)}:${encodeURIComponent(apiKey)}@${GIGALIXIR_GIT_HOST}\n`
  fs.writeFileSync('.git-credentials', credentialLine, { mode: 0o600 })

  core.info('Git credentials configured')
}

async function addGigalixirRemote(remoteUrl: string): Promise<void> {
  core.info('Configuring Gigalixir git remote...')

  // Check if remote already exists
  let remoteExists = false
  try {
    await exec.exec('git', ['remote', 'get-url', 'gigalixir'], {
      silent: true
    })
    remoteExists = true
  } catch {
    // Remote doesn't exist, which is fine
  }

  if (remoteExists) {
    await exec.exec('git', ['remote', 'set-url', 'gigalixir', remoteUrl])
    core.info('Updated existing Gigalixir remote')
  } else {
    await exec.exec('git', ['remote', 'add', 'gigalixir', remoteUrl])
    core.info('Added Gigalixir remote')
  }
}

async function pushToGigalixir(
  gitRef: string,
  cleanCache: boolean
): Promise<void> {
  core.info('Pushing to Gigalixir...')

  const args = cleanCache
    ? [
        '-c',
        'http.extraheader=GIGALIXIR-CLEAN: true',
        'push',
        'gigalixir',
        `${gitRef}:refs/heads/main`,
        '-f'
      ]
    : ['push', 'gigalixir', `${gitRef}:refs/heads/main`, '-f']

  await exec.exec('git', args)

  core.info('Push completed')
}

async function subtreePushToGigalixir(
  subfolder: string,
  cleanCache: boolean
): Promise<void> {
  core.info(`Pushing subtree "${subfolder}" to Gigalixir...`)

  const args = cleanCache
    ? [
        '-c',
        'http.extraheader=GIGALIXIR-CLEAN: true',
        'subtree',
        'push',
        '--prefix',
        subfolder,
        'gigalixir',
        'main'
      ]
    : ['subtree', 'push', '--prefix', subfolder, 'gigalixir', 'main']

  await exec.exec('git', args)

  core.info('Subtree push completed')
}

async function cleanupGitCredentials(): Promise<void> {
  core.info('Cleaning up credentials...')

  try {
    if (fs.existsSync('.git-credentials')) {
      fs.unlinkSync('.git-credentials')
    }

    await exec.exec(
      'git',
      ['config', '--local', '--unset', 'credential.helper'],
      { ignoreReturnCode: true }
    )
  } catch {
    core.warning('Failed to clean up some credentials')
  }

  core.info('Cleanup completed')
}

// Run the action
run()
