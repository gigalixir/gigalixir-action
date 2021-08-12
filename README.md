# Gigalixir Action

This action will deploy your elixir application to Gigalixir and will run your migrations automatically.

Note: This action has only been tested in one repo and has no unit tests.

## Usage

```yaml
test:
  # A job to run your tests, linters, etc

deploy:
  needs: test # Will only run if the test job succeeds
  if: github.ref == 'refs/heads/main' # Only run this job if it is on the main branch

  runs-on: ubuntu-latest

  steps:
    - uses: actions/checkout@v2
      with:
        ref: main # Check out main instead of the latest commit
        fetch-depth: 0 # Checkout the whole branch

    - uses: actions/setup-python@v2
      with:
        python-version: 3.8.1

    - uses: mhanberg/gigalixir-action@<current release>
      with:
        APP_SUBFOLDER: my-app-subfolder  # Add only if you want to deploy an app that is not at the root of your repository
        GIGALIXIR_APP: my-gigalixir-app # Feel free to also put this in your secrets
        GIGALIXIR_CLEAN: true # defaults to false
        GIGALIXIR_USERNAME: ${{ secrets.GIGALIXIR_USERNAME }}
        GIGALIXIR_PASSWORD: ${{ secrets.GIGALIXIR_PASSWORD }}
        MIGRATIONS: false  # defaults to true
        SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
        MIGRATION_COMMAND: ps.migrate # defaults to 'ps.migrate' but could also be 'ps:run mix ecto.migrate'. Add it to secrets if you like.
```

## Migrations

If your application runs as an Elixir release and `MIGRATIONS: true` (per the
above config), your migration command will be `gigalixir ps:migrate -a
my-cool-app`, which is set as the default.

This requires that you have a public key uploaded to the
app's container and a private key supplied as `SSH_PRIVATE_KEY` in the secrets
above, as well as your username and password.

If your application uses some other command to migrate -- `gigalixir ps:run mix
ecto.migrate` because it runs in Mix-mode, you can set `MIGRATION_COMMAND: run
mix ecto.migrate`. It has the same requirements. `gigalixir` is prepended and
`-a my-cool-app` is appended to whatever you provide.

Using `ps:run mix ecto.migrate` instead of `run mix ecto.migrate` will force
gigalixir to run the command in the current container rather than a new
container and will raise an error if the migration fails.

Please see the docs for [How to Run Migrations](https://gigalixir.readthedocs.io/en/latest/main.html#migrations) for more information.

If your migrations fail, the action will rollback the app to the last version.

## Contributing

Remember to

- `npm install`
- `npm run package`
