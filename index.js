const core = require('@actions/core');
const exec = require('@actions/exec');
const path = require('path');

function wait(seconds) {
  return new Promise(resolve => {
    if ((typeof seconds) !== 'number') {
      throw new Error('seconds not a number');
    }

    core.info(`Waiting ${seconds} seconds...`);

    setTimeout(() => resolve("done!"), seconds * 1000)
  });
}

async function isNextReleaseHealthy(release, app) {
  let releasesOutput = '';

  const options = {
    listeners: {
      stdout: data => {
        releasesOutput += data.toString();
      }
    }
  };

  await core.group("Getting current replicas", async () => {
    await exec.exec(`gigalixir ps -a ${app}`, [], options);
  });

  const releases = JSON.parse(releasesOutput);
  return releases.pods.filter((pod) => (Number(pod.version) === release && pod.status === "Healthy")).length >= releases.replicas_desired;
}

async function waitForNewRelease(oldRelease, app, attempts) {
  const maxAttempts = 60;

  if (await isNextReleaseHealthy(oldRelease + 1, app)) {
    return await Promise.resolve(true);
  } else {
    if (attempts <= maxAttempts) {
      await wait(10);
      await waitForNewRelease(oldRelease, app, attempts + 1);
    } else {
      throw "Taking too long for new release to deploy";
    }
  }
}

async function getCurrentRelease(app) {
  let releasesOutput = '';

  const options = {
    listeners: {
      stdout: data => {
        releasesOutput += data.toString();
      }
    }
  };

  await core.group("Getting current release", async () => {
    await exec.exec(`gigalixir releases -a ${app}`, [], options);
  });

  const releases = JSON.parse(releasesOutput);
  const currentRelease = releases.length ? Number(releases[0].version) : 0;

  return currentRelease;
}

function formatReleaseMessage(releaseNumber) {
  return releaseNumber ?
    `The current release is ${releaseNumber}` :
    "This is the first release";
}

function addExtraFlagCleanCache(gigalixirClean) {
  return (gigalixirClean === "true") ? ` -c http.extraheader="GIGALIXIR-CLEAN: true" ` : ""
}

async function run() {
  try {
    const appSubfolder = core.getInput('APP_SUBFOLDER', {required: false});
    const gigalixirApp = core.getInput('GIGALIXIR_APP', {required: true});
    const gigalixirClean = core.getInput('GIGALIXIR_CLEAN', {required: false});
    const gigalixirUsername = core.getInput('GIGALIXIR_USERNAME', {required: true});
    const gigalixirPassword = core.getInput('GIGALIXIR_PASSWORD', {required: true});
    const migrations = core.getInput('MIGRATIONS', {required: true});
    const sshPrivateKey = core.getInput('SSH_PRIVATE_KEY', {required: JSON.parse(migrations)});

    await core.group("Installing gigalixir", async () => {
      await exec.exec('pip3 install gigalixir')
    });

    await core.group("Logging in to gigalixir", async () => {
      await exec.exec(`gigalixir login -e "${gigalixirUsername}" -y -p "${gigalixirPassword}"`)
    });

    await core.group("Setting git remote for gigalixir", async () => {
      await exec.exec(`gigalixir git:remote ${gigalixirApp}`);
    });

    const currentRelease = await core.group("Getting current release", async () => {
      return await getCurrentRelease(gigalixirApp);
    });

    core.info(formatReleaseMessage(currentRelease));

    await core.group("Deploying to gigalixir", async () => {
      if (appSubfolder) {
        await exec.exec(`git ${addExtraFlagCleanCache(gigalixirClean)} subtree push --prefix ${appSubfolder} gigalixir master`);
      } else {
        await exec.exec(`git ${addExtraFlagCleanCache(gigalixirClean)} push -f gigalixir HEAD:refs/heads/master`);
      }
    });

    if (migrations === "true") {
      await core.group("Adding private key to gigalixir", async () => {
        await exec.exec(path.join(__dirname, "../bin/add-private-key"), [sshPrivateKey]);
      });

      await core.group("Waiting for new release to deploy", async () => {
        await waitForNewRelease(currentRelease, gigalixirApp, 1);
      });

      try {
        await core.group("Running migrations", async () => {
          await exec.exec(`gigalixir ps:migrate -a ${gigalixirApp}`)
        });
      } catch (error) {
        if (currentRelease === 0) {
          core.warning("Migration failed");
        } else {
          core.warning(`Migration failed, rolling back to the previous release: ${currentRelease}`);
          await core.group("Rolling back", async () => {
            await exec.exec(`gigalixir releases:rollback -a ${gigalixirApp}`)
          });
        }

        core.setFailed(error.message);
      }
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
