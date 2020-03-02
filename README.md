# Gigalixir Action

This action will deploy your elixir application to Gigalixir and will run your migrations automatically.

Note: This action has only been tested in one repo and has no unit tests.

## Usage

```yaml
test: 
  # A job to run your tests, linters, etc

deploy:
  needs: test # Will only run if the test job succeeds
  if: github.ref == 'refs/heads/master' # Only run this job if it is on the master branch

  runs-on: ubuntu-latest

  steps:
    - uses: actions/checkout@v2
      with:
        ref: master # Checkout out master instead of the latest commit
        fetch-depth: 0 # Checkout the whole branch

    - uses: ./.github/actions/gigalixir
      with:
        GIGALIXIR_USERNAME: ${{ secrets.GIGALIXIR_USERNAME }}
        GIGALIXIR_PASSWORD: ${{ secrets.GIGALIXIR_PASSWORD }}
        GIGALIXIR_APP: my-gigalixir-app # Feel free to also put this in your secrets
        SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
```

## Migrations

Currently running migrations is only supported when your app is deployed as a mix release.

The migrations are run with the `gigalixir ps:migrate` command, which requires having a public key uploaded to your app's container and a private key locally to connect via an `ssh` connection.

Please see the docs for [How to Run Migrations](https://gigalixir.readthedocs.io/en/latest/main.html#migrations) for more information.

If your migrations fail, the action will rollback the app to the last version.

Note: The migrations will always be run, so if you application doesn't have a database, please submit a PR to be able to configure the behavior.

## Contributing

Remember to 

- `npm install`
- `npm run package`
