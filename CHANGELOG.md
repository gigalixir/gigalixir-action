# Changelog

## v0.6.2

- Handle boolean string again as to not always use GIGALIXIR_CLEAN header [#41](https://github.com/mhanberg/gigalixir-action/pull/41) by [Ian Young](https://github.com/iangreenleaf)


## v0.6.1

- Coerce stringified boolean to an actual bool [#38](https://github.com/mhanberg/gigalixir-action/pull/38) by [Mitch Hanberg](https://github.com/mhanberg)

## v0.6.0

- Add option to clean build cache -[#35](https://github.com/mhanberg/gigalixir-action/pull/35) by [Raul Pereira](https://github.com/raulpe7eira)
- Only require SSH key if you have migratinos configured -[#35](https://github.com/mhanberg/gigalixir-action/pull/35) by [Raul Pereira](https://github.com/raulpe7eira)

## v0.5.0

- Add subfolder support - [#34](https://github.com/mhanberg/gigalixir-action/pull/34) by [Christian Tovar](https://github.com/ChristianTovar)

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
