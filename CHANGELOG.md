# Changelog

## v0.4.3

- Fix broken build

## v0.4.2

- De-sudo call to `pip`

## v0.4.1

- Deployment works if the action is making the very first deployment.

## v0.4.0

- Fixed an issue where the action would get stuck at 'Getting current replicas' for apps requesting more than one replica
- Does a health check every 10 seconds instead of increasing the wait time exponentially. Times out now after 10 minutes.

## v0.3.0

- Only add private key and wait for deploy if we are migrating [(#9)](https://github.com/mhanberg/gigalixir-action/pull/9)

## v0.2.1

- Update NPM packages

## v0.2.0

- Config option to run without migrations

## v0.1.0

- Initial Release
