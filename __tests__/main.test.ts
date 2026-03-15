import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fs from 'fs'

// Mock the modules
jest.mock('@actions/core')
jest.mock('@actions/exec')
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(() => true),
  unlinkSync: jest.fn()
}))

// Mock https module
jest.mock('https', () => ({
  request: jest.fn()
}))

const mockedCore = jest.mocked(core)
const mockedExec = jest.mocked(exec)
const mockedFs = jest.mocked(fs)

describe('Gigalixir Deploy Action', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()

    // Reset environment
    process.env = { ...originalEnv, GITHUB_SHA: 'abc123' }

    // Default mock implementations for deploy action
    mockedCore.getInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        gigalixir_email: 'test@example.com',
        gigalixir_api_key: 'test-api-key',
        app_name: 'test-app',
        action: 'deploy',
        git_ref: '',
        github_deployments: 'false'
      }
      return inputs[name] || ''
    })

    mockedExec.exec.mockResolvedValue(0)
    mockedFs.existsSync.mockReturnValue(true)
  })

  afterEach(() => {
    // Clean up any INPUT_CONFIG_* env vars set during tests
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('INPUT_CONFIG_')) {
        delete process.env[key]
      }
    }
    process.env = originalEnv
  })

  // Import run function fresh for each test
  async function runAction(): Promise<void> {
    const { run } = await import('../src/main')
    await run()
  }

  describe('deploy action', () => {
    it('should mask the API key', async () => {
      await runAction()
      expect(mockedCore.setSecret).toHaveBeenCalledWith('test-api-key')
    })

    it('should configure git credentials', async () => {
      await runAction()

      expect(mockedExec.exec).toHaveBeenCalledWith('git', [
        'config',
        '--local',
        'credential.helper',
        'store --file=.git-credentials'
      ])
    })

    it('should write credentials file with correct content', async () => {
      await runAction()

      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        '.git-credentials',
        'https://test%40example.com:test-api-key@git.gigalixir.com\n',
        { mode: 0o600 }
      )
    })

    it('should add gigalixir remote when it does not exist', async () => {
      mockedExec.exec.mockImplementation(async (_cmd, args) => {
        if (args && args.includes('get-url')) {
          throw new Error('Remote not found')
        }
        return 0
      })

      await runAction()

      expect(mockedExec.exec).toHaveBeenCalledWith('git', [
        'remote',
        'add',
        'gigalixir',
        'https://git.gigalixir.com/test-app.git/'
      ])
    })

    it('should update gigalixir remote when it exists', async () => {
      mockedExec.exec.mockResolvedValue(0)

      await runAction()

      expect(mockedExec.exec).toHaveBeenCalledWith('git', [
        'remote',
        'set-url',
        'gigalixir',
        'https://git.gigalixir.com/test-app.git/'
      ])
    })

    it('should push to gigalixir master branch', async () => {
      await runAction()

      expect(mockedExec.exec).toHaveBeenCalledWith('git', [
        'push',
        'gigalixir',
        'abc123:refs/heads/main',
        '-f'
      ])
    })

    it('should use git_ref input when provided', async () => {
      mockedCore.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          gigalixir_email: 'test@example.com',
          gigalixir_api_key: 'test-api-key',
          app_name: 'test-app',
          action: 'deploy',
          git_ref: 'v1.0.0'
        }
        return inputs[name] || ''
      })

      await runAction()

      expect(mockedExec.exec).toHaveBeenCalledWith('git', [
        'push',
        'gigalixir',
        'v1.0.0:refs/heads/main',
        '-f'
      ])
    })

    it('should set deploy_status output on success', async () => {
      await runAction()

      expect(mockedCore.setOutput).toHaveBeenCalledWith(
        'deploy_status',
        'success'
      )
    })

    it('should set app_name and app_url outputs', async () => {
      await runAction()

      expect(mockedCore.setOutput).toHaveBeenCalledWith('app_name', 'test-app')
      expect(mockedCore.setOutput).toHaveBeenCalledWith(
        'app_url',
        'https://test-app.gigalixirapp.com'
      )
    })

    it('should clean up credentials file after deployment', async () => {
      await runAction()

      expect(mockedFs.unlinkSync).toHaveBeenCalledWith('.git-credentials')
    })

    it('should handle errors and set failure status', async () => {
      mockedExec.exec.mockRejectedValue(new Error('Git push failed'))

      await runAction()

      expect(mockedCore.setOutput).toHaveBeenCalledWith(
        'deploy_status',
        'failure'
      )
      expect(mockedCore.setFailed).toHaveBeenCalledWith('Git push failed')
    })

    it('should use git subtree push when app_subfolder is set', async () => {
      mockedCore.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          gigalixir_email: 'test@example.com',
          gigalixir_api_key: 'test-api-key',
          app_name: 'test-app',
          action: 'deploy',
          git_ref: '',
          app_subfolder: 'apps/my-app',
          github_deployments: 'false'
        }
        return inputs[name] || ''
      })

      await runAction()

      expect(mockedExec.exec).toHaveBeenCalledWith('git', [
        'subtree',
        'push',
        '--prefix',
        'apps/my-app',
        'gigalixir',
        'main'
      ])
    })

    it('should not use subtree push when app_subfolder is empty', async () => {
      await runAction()

      expect(mockedExec.exec).not.toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['subtree'])
      )
      expect(mockedExec.exec).toHaveBeenCalledWith('git', [
        'push',
        'gigalixir',
        'abc123:refs/heads/main',
        '-f'
      ])
    })

    it('should add clean cache header when clean_build_cache is true', async () => {
      mockedCore.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          gigalixir_email: 'test@example.com',
          gigalixir_api_key: 'test-api-key',
          app_name: 'test-app',
          action: 'deploy',
          git_ref: '',
          clean_build_cache: 'true',
          github_deployments: 'false'
        }
        return inputs[name] || ''
      })

      await runAction()

      expect(mockedExec.exec).toHaveBeenCalledWith('git', [
        '-c',
        'http.extraheader=GIGALIXIR-CLEAN: true',
        'push',
        'gigalixir',
        'abc123:refs/heads/main',
        '-f'
      ])
    })

    it('should add clean cache header to subtree push when both options set', async () => {
      mockedCore.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          gigalixir_email: 'test@example.com',
          gigalixir_api_key: 'test-api-key',
          app_name: 'test-app',
          action: 'deploy',
          git_ref: '',
          app_subfolder: 'apps/my-app',
          clean_build_cache: 'true',
          github_deployments: 'false'
        }
        return inputs[name] || ''
      })

      await runAction()

      expect(mockedExec.exec).toHaveBeenCalledWith('git', [
        '-c',
        'http.extraheader=GIGALIXIR-CLEAN: true',
        'subtree',
        'push',
        '--prefix',
        'apps/my-app',
        'gigalixir',
        'main'
      ])
    })

    it('should not add clean cache header when clean_build_cache is false', async () => {
      await runAction()

      expect(mockedExec.exec).not.toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['GIGALIXIR-CLEAN'])
      )
    })
  })

  describe('config_ prefix', () => {
    // Helper to set up https mock for API responses
    function mockHttpsResponse(statusCode: number, body: string): void {
      const https = require('https')
      https.request.mockImplementation(
        (
          _options: unknown,
          callback: (res: {
            statusCode: number
            on: (event: string, cb: (data?: string) => void) => void
          }) => void
        ) => {
          const res = {
            statusCode,
            on: jest.fn((event: string, cb: (data?: string) => void) => {
              if (event === 'data') cb(body)
              if (event === 'end') cb()
            })
          }
          callback(res)
          return {
            on: jest.fn(),
            write: jest.fn(),
            end: jest.fn()
          }
        }
      )
    }

    it('should set config before deploy when config_ inputs are provided', async () => {
      process.env.INPUT_CONFIG_FOO = 'bar'
      process.env.INPUT_CONFIG_BAZ = 'qux'
      mockHttpsResponse(201, '{}')

      await runAction()

      const https = require('https')
      expect(https.request).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: 'api.gigalixir.com',
          path: '/api/apps/test-app/configs',
          method: 'POST'
        }),
        expect.any(Function)
      )
      const writeCall = https.request.mock.results[0].value.write
      expect(writeCall).toHaveBeenCalledWith(
        JSON.stringify({
          configs: { FOO: 'bar', BAZ: 'qux' },
          avoid_restart: true
        })
      )
    })

    it('should handle values containing special characters', async () => {
      process.env.INPUT_CONFIG_DATABASE_URL = 'postgres://u:p@host/db?opt=1'
      mockHttpsResponse(201, '{}')

      await runAction()

      const https = require('https')
      const writeCall = https.request.mock.results[0].value.write
      expect(writeCall).toHaveBeenCalledWith(
        JSON.stringify({
          configs: { DATABASE_URL: 'postgres://u:p@host/db?opt=1' },
          avoid_restart: true
        })
      )
    })

    it('should fail when config API returns error', async () => {
      process.env.INPUT_CONFIG_FOO = 'bar'
      mockHttpsResponse(422, '{"errors":{"configs":["is invalid"]}}')

      await runAction()

      expect(mockedCore.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('API request failed: 422')
      )
    })

    it('should not make API call when no config_ inputs exist', async () => {
      await runAction()

      const https = require('https')
      expect(https.request).not.toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/api/apps/test-app/configs'
        }),
        expect.any(Function)
      )
    })
  })

  describe('deployment verification', () => {
    // Helper to set up https mock for sequential API responses
    function mockHttpsResponses(
      responses: { statusCode: number; body: string }[]
    ): void {
      const https = require('https')
      let callIndex = 0
      https.request.mockImplementation(
        (
          _options: unknown,
          callback: (res: {
            statusCode: number
            on: (event: string, cb: (data?: string) => void) => void
          }) => void
        ) => {
          const response =
            responses[callIndex] || responses[responses.length - 1]
          callIndex++
          const res = {
            statusCode: response.statusCode,
            on: jest.fn((event: string, cb: (data?: string) => void) => {
              if (event === 'data') cb(response.body)
              if (event === 'end') cb()
            })
          }
          callback(res)
          return {
            on: jest.fn(),
            write: jest.fn(),
            end: jest.fn()
          }
        }
      )
    }

    // Mock exec to handle git rev-parse for SHA resolution
    function mockExecWithRevParse(sha: string): void {
      mockedExec.exec.mockImplementation(
        async (_cmd: string, args?: string[], options?: Record<string, unknown>) => {
          if (args && args[0] === 'rev-parse' && options?.listeners) {
            const listeners = options.listeners as { stdout?: (data: Buffer) => void }
            listeners.stdout?.(Buffer.from(sha))
          }
          return 0
        }
      )
    }

    beforeEach(() => {
      jest.useFakeTimers({ advanceTimers: true })
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('should skip verification when deploy_timeout is 0', async () => {
      mockedCore.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          gigalixir_email: 'test@example.com',
          gigalixir_api_key: 'test-api-key',
          app_name: 'test-app',
          action: 'deploy',
          git_ref: '',
          deploy_timeout: '0',
          github_deployments: 'false'
        }
        return inputs[name] || ''
      })

      await runAction()

      const https = require('https')
      expect(https.request).not.toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/api/apps/test-app/status'
        }),
        expect.any(Function)
      )
      expect(mockedCore.setOutput).toHaveBeenCalledWith(
        'deploy_status',
        'success'
      )
    })

    it('should skip verification when deploy_timeout is not set', async () => {
      await runAction()

      const https = require('https')
      expect(https.request).not.toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/api/apps/test-app/status'
        }),
        expect.any(Function)
      )
    })

    it('should poll until all new pods are healthy', async () => {
      mockedCore.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          gigalixir_email: 'test@example.com',
          gigalixir_api_key: 'test-api-key',
          app_name: 'test-app',
          action: 'deploy',
          git_ref: '',
          deploy_timeout: '90',
          github_deployments: 'false'
        }
        return inputs[name] || ''
      })
      mockExecWithRevParse('abc123')

      // First poll: old pods still running, new pod starting
      // Second poll: all new pods healthy
      mockHttpsResponses([
        {
          statusCode: 200,
          body: JSON.stringify({
            data: {
              replicas_desired: 1,
              pods: [
                {
                  name: 'test-app-old',
                  sha: 'oldsha1',
                  status: 'Healthy',
                  version: '1'
                },
                {
                  name: 'test-app-new',
                  sha: 'abc123',
                  status: 'Starting',
                  version: '2'
                }
              ]
            }
          })
        },
        {
          statusCode: 200,
          body: JSON.stringify({
            data: {
              replicas_desired: 1,
              pods: [
                {
                  name: 'test-app-new',
                  sha: 'abc123',
                  status: 'Healthy',
                  version: '2'
                }
              ]
            }
          })
        }
      ])

      const actionPromise = runAction()
      // Advance past the first poll interval
      await jest.advanceTimersByTimeAsync(10_000)
      await actionPromise

      expect(mockedCore.setOutput).toHaveBeenCalledWith(
        'deploy_status',
        'success'
      )
      expect(mockedCore.info).toHaveBeenCalledWith(
        expect.stringContaining('Deployment rollout complete')
      )
    })

    it('should timeout and call setFailed with status summary', async () => {
      mockedCore.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          gigalixir_email: 'test@example.com',
          gigalixir_api_key: 'test-api-key',
          app_name: 'test-app',
          action: 'deploy',
          git_ref: '',
          deploy_timeout: '15',
          github_deployments: 'false'
        }
        return inputs[name] || ''
      })
      mockExecWithRevParse('abc123')

      // All polls return unhealthy pods
      mockHttpsResponses([
        {
          statusCode: 200,
          body: JSON.stringify({
            data: {
              replicas_desired: 1,
              pods: [
                {
                  name: 'test-app-pod',
                  sha: 'abc123',
                  status: 'Starting',
                  version: '2'
                }
              ]
            }
          })
        }
      ])

      const actionPromise = runAction()
      // Advance timers past the timeout
      await jest.advanceTimersByTimeAsync(30_000)
      await actionPromise

      expect(mockedCore.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Deployment rollout timed out after 15s')
      )
      expect(mockedCore.setOutput).toHaveBeenCalledWith(
        'deploy_status',
        'failure'
      )
    })

    it('should handle API errors during polling gracefully', async () => {
      mockedCore.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          gigalixir_email: 'test@example.com',
          gigalixir_api_key: 'test-api-key',
          app_name: 'test-app',
          action: 'deploy',
          git_ref: '',
          deploy_timeout: '90',
          github_deployments: 'false'
        }
        return inputs[name] || ''
      })
      mockExecWithRevParse('abc123')

      // First poll: API error, second poll: success
      mockHttpsResponses([
        {
          statusCode: 500,
          body: 'Internal Server Error'
        },
        {
          statusCode: 200,
          body: JSON.stringify({
            data: {
              replicas_desired: 1,
              pods: [
                {
                  name: 'test-app-pod',
                  sha: 'abc123',
                  status: 'Healthy',
                  version: '2'
                }
              ]
            }
          })
        }
      ])

      const actionPromise = runAction()
      await jest.advanceTimersByTimeAsync(10_000)
      await actionPromise

      expect(mockedCore.warning).toHaveBeenCalledWith(
        expect.stringContaining('Failed to check deployment status')
      )
      expect(mockedCore.setOutput).toHaveBeenCalledWith(
        'deploy_status',
        'success'
      )
    })
  })

  describe('destroy action', () => {
    function mockHttpsResponses(
      responses: { statusCode: number; body: string }[]
    ): void {
      const https = require('https')
      let callIndex = 0
      https.request.mockImplementation(
        (
          _options: unknown,
          callback: (res: {
            statusCode: number
            on: (event: string, cb: (data?: string) => void) => void
          }) => void
        ) => {
          const response =
            responses[callIndex] || responses[responses.length - 1]
          callIndex++
          const res = {
            statusCode: response.statusCode,
            on: jest.fn((event: string, cb: (data?: string) => void) => {
              if (event === 'data') cb(response.body)
              if (event === 'end') cb()
            })
          }
          callback(res)
          return {
            on: jest.fn(),
            write: jest.fn(),
            end: jest.fn()
          }
        }
      )
    }

    it('should scale to 0 replicas before deleting the app', async () => {
      mockedCore.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          gigalixir_email: 'test@example.com',
          gigalixir_api_key: 'test-api-key',
          app_name: 'test-app',
          action: 'destroy',
          github_deployments: 'false'
        }
        return inputs[name] || ''
      })

      // 1st call: GET app (check exists) -> 200
      // 2nd call: PUT scale -> 200
      // 3rd call: DELETE app -> 200
      mockHttpsResponses([
        { statusCode: 200, body: '{}' },
        { statusCode: 200, body: '{}' },
        { statusCode: 200, body: '{}' }
      ])

      await runAction()

      const https = require('https')
      const calls = https.request.mock.calls

      // Verify scale call happens before delete
      const scaleCall = calls.find(
        (c: [{ path: string; method: string }]) =>
          c[0].path === '/api/apps/test-app/scale' && c[0].method === 'PUT'
      )
      const deleteCall = calls.find(
        (c: [{ path: string; method: string }]) =>
          c[0].path === '/api/apps/test-app' && c[0].method === 'DELETE'
      )
      expect(scaleCall).toBeDefined()
      expect(deleteCall).toBeDefined()

      // Verify scale sends replicas: 0
      const scaleCallIndex = calls.indexOf(scaleCall)
      const deleteCallIndex = calls.indexOf(deleteCall)
      expect(scaleCallIndex).toBeLessThan(deleteCallIndex)

      const writeCall = https.request.mock.results[scaleCallIndex].value.write
      expect(writeCall).toHaveBeenCalledWith(JSON.stringify({ replicas: 0 }))

      expect(mockedCore.setOutput).toHaveBeenCalledWith(
        'deploy_status',
        'success'
      )
    })
  })

  describe('action types', () => {
    it('should handle unknown action type', async () => {
      mockedCore.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          gigalixir_email: 'test@example.com',
          gigalixir_api_key: 'test-api-key',
          app_name: 'test-app',
          action: 'unknown_action'
        }
        return inputs[name] || ''
      })

      await runAction()

      expect(mockedCore.setFailed).toHaveBeenCalledWith(
        'Unknown action: unknown_action'
      )
    })
  })

  describe('backwards-compatible aliases', () => {
    it('should accept deprecated input names with warnings', async () => {
      mockedCore.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          GIGALIXIR_USERNAME: 'old@example.com',
          GIGALIXIR_PASSWORD: 'old-api-key',
          GIGALIXIR_APP: 'old-app',
          action: 'deploy',
          github_deployments: 'false'
        }
        return inputs[name] || ''
      })

      await runAction()

      expect(mockedCore.warning).toHaveBeenCalledWith(
        "Input 'GIGALIXIR_USERNAME' is deprecated. Use 'gigalixir_email' instead."
      )
      expect(mockedCore.warning).toHaveBeenCalledWith(
        "Input 'GIGALIXIR_PASSWORD' is deprecated. Use 'gigalixir_api_key' instead."
      )
      expect(mockedCore.warning).toHaveBeenCalledWith(
        "Input 'GIGALIXIR_APP' is deprecated. Use 'app_name' instead."
      )
      expect(mockedCore.setSecret).toHaveBeenCalledWith('old-api-key')
    })

    it('should prefer new input names over deprecated ones', async () => {
      mockedCore.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          gigalixir_email: 'new@example.com',
          gigalixir_api_key: 'new-api-key',
          app_name: 'new-app',
          GIGALIXIR_USERNAME: 'old@example.com',
          GIGALIXIR_PASSWORD: 'old-api-key',
          GIGALIXIR_APP: 'old-app',
          action: 'deploy',
          github_deployments: 'false'
        }
        return inputs[name] || ''
      })

      await runAction()

      // Should not warn when new names are provided
      expect(mockedCore.warning).not.toHaveBeenCalledWith(
        expect.stringContaining('deprecated')
      )
      expect(mockedCore.setSecret).toHaveBeenCalledWith('new-api-key')
    })

    it('should fail when neither new nor deprecated email is provided', async () => {
      mockedCore.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          gigalixir_api_key: 'test-api-key',
          app_name: 'test-app',
          action: 'deploy'
        }
        return inputs[name] || ''
      })

      await runAction()

      expect(mockedCore.setFailed).toHaveBeenCalledWith(
        "Input required and not supplied: 'gigalixir_email'"
      )
    })

    it('should fail when MIGRATIONS is set to true', async () => {
      mockedCore.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          gigalixir_email: 'test@example.com',
          gigalixir_api_key: 'test-api-key',
          app_name: 'test-app',
          action: 'deploy',
          MIGRATIONS: 'true'
        }
        return inputs[name] || ''
      })

      await runAction()

      expect(mockedCore.setFailed).toHaveBeenCalledWith(
        expect.stringContaining(
          'MIGRATIONS and SSH_PRIVATE_KEY inputs are not supported'
        )
      )
      expect(mockedCore.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('gigalixir/gigalixir-action@v0')
      )
    })

    it('should fail when SSH_PRIVATE_KEY is provided', async () => {
      mockedCore.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          gigalixir_email: 'test@example.com',
          gigalixir_api_key: 'test-api-key',
          app_name: 'test-app',
          action: 'deploy',
          SSH_PRIVATE_KEY: 'some-key'
        }
        return inputs[name] || ''
      })

      await runAction()

      expect(mockedCore.setFailed).toHaveBeenCalledWith(
        expect.stringContaining(
          'MIGRATIONS and SSH_PRIVATE_KEY inputs are not supported'
        )
      )
    })
  })

  describe('scale action', () => {
    function mockHttpsResponse(statusCode: number, body: string): void {
      const https = require('https')
      https.request.mockImplementation(
        (
          _options: unknown,
          callback: (res: {
            statusCode: number
            on: (event: string, cb: (data?: string) => void) => void
          }) => void
        ) => {
          const res = {
            statusCode,
            on: jest.fn((event: string, cb: (data?: string) => void) => {
              if (event === 'data') cb(body)
              if (event === 'end') cb()
            })
          }
          callback(res)
          return {
            on: jest.fn(),
            write: jest.fn(),
            end: jest.fn()
          }
        }
      )
    }

    it('should scale with replicas only', async () => {
      mockedCore.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          gigalixir_email: 'test@example.com',
          gigalixir_api_key: 'test-api-key',
          app_name: 'test-app',
          action: 'scale',
          replicas: '2',
          github_deployments: 'false'
        }
        return inputs[name] || ''
      })
      mockHttpsResponse(200, '{}')

      await runAction()

      const https = require('https')
      expect(https.request).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: 'api.gigalixir.com',
          path: '/api/apps/test-app/scale',
          method: 'PUT'
        }),
        expect.any(Function)
      )
      const writeCall = https.request.mock.results[0].value.write
      expect(writeCall).toHaveBeenCalledWith(JSON.stringify({ replicas: 2 }))
      expect(mockedCore.setOutput).toHaveBeenCalledWith(
        'deploy_status',
        'success'
      )
    })

    it('should scale with size only', async () => {
      mockedCore.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          gigalixir_email: 'test@example.com',
          gigalixir_api_key: 'test-api-key',
          app_name: 'test-app',
          action: 'scale',
          size: '0.5',
          github_deployments: 'false'
        }
        return inputs[name] || ''
      })
      mockHttpsResponse(200, '{}')

      await runAction()

      const https = require('https')
      const writeCall = https.request.mock.results[0].value.write
      expect(writeCall).toHaveBeenCalledWith(JSON.stringify({ size: 0.5 }))
      expect(mockedCore.setOutput).toHaveBeenCalledWith(
        'deploy_status',
        'success'
      )
    })

    it('should scale with both replicas and size', async () => {
      mockedCore.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          gigalixir_email: 'test@example.com',
          gigalixir_api_key: 'test-api-key',
          app_name: 'test-app',
          action: 'scale',
          replicas: '3',
          size: '1.0',
          github_deployments: 'false'
        }
        return inputs[name] || ''
      })
      mockHttpsResponse(200, '{}')

      await runAction()

      const https = require('https')
      const writeCall = https.request.mock.results[0].value.write
      expect(writeCall).toHaveBeenCalledWith(
        JSON.stringify({ replicas: 3, size: 1 })
      )
      expect(mockedCore.setOutput).toHaveBeenCalledWith(
        'deploy_status',
        'success'
      )
    })

    it('should fail when neither replicas nor size is set', async () => {
      mockedCore.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          gigalixir_email: 'test@example.com',
          gigalixir_api_key: 'test-api-key',
          app_name: 'test-app',
          action: 'scale',
          github_deployments: 'false'
        }
        return inputs[name] || ''
      })

      await runAction()

      expect(mockedCore.setFailed).toHaveBeenCalledWith(
        'At least one of replicas or size must be provided for scale action'
      )
    })
  })
})
