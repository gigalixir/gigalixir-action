const core = require('@actions/core');
const exec = require('@actions/exec');
const path = require('path');

function wait(seconds) {
  return new Promise(resolve => {
    if (typeof (seconds) !== 'number') {
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
  // first release number in gigalixir is 1
  const currentRelease = releases.length && Number(releases[0].version) || 0;

  return currentRelease;
}

function printRelease(releaseNumber) {
  return releaseNumber || "[NO PREV RELEASE]"
}

async function run() {
  try {
    const gigalixirUsername = core.getInput('GIGALIXIR_USERNAME', {
      required: true
    });
    const gigalixirPassword = core.getInput('GIGALIXIR_PASSWORD', {
      required: true
    });
    const sshPrivateKey = core.getInput('SSH_PRIVATE_KEY', {
      required: true
    });
    const gigalixirApp = core.getInput('GIGALIXIR_APP', {
      required: true
    });
    const migrations = core.getInput('MIGRATIONS', {
      required: true
    });

    await core.group("Installing gigalixir", async () => {
      await exec.exec('sudo pip install gigalixir --ignore-installed six')
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
    core.info(`The current release is ${printRelease(currentRelease)}`);

    await core.group("Deploying to gigalixir", async () => {
      await exec.exec("git push -f gigalixir HEAD:refs/heads/master");
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
        core.warning(`Migration failed, rolling back to the previous release: ${printRelease(currentRelease)}`);
        await core.group("Rolling back", async () => {
          await exec.exec(`gigalixir releases:rollback -a ${gigalixirApp}`)
        });

        core.setFailed(error.message);
      }
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();