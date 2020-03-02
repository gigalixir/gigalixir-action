const core = require('@actions/core');
const exec = require('@actions/exec');
const path = require('path');

function wait(seconds) {
  return new Promise(resolve => {
    if (typeof(seconds) !== 'number') { 
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

  const pods = JSON.parse(releasesOutput).pods;
  const pod = pods[0];

  return pods.length === 1 && parseInt(pod.version) === release && pod.status === "Healthy";
}

async function waitForNewRelease(oldRelease, app, multiplier) {
  if (await isNextReleaseHealthy(oldRelease + 1, app)) {
    return await Promise.resolve(true);
  } else {
    if (multiplier <= 5) {
      await wait(Math.pow(2, multiplier));

      await waitForNewRelease(oldRelease, app, multiplier + 1);
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

  const currentRelease = parseInt(JSON.parse(releasesOutput)[0].version);

  return currentRelease;
}

async function run() {
  try { 
    const gigalixirUsername = core.getInput('GIGALIXIR_USERNAME', { required: true });
    const gigalixirPassword = core.getInput('GIGALIXIR_PASSWORD', { required: true });
    const sshPrivateKey = core.getInput('SSH_PRIVATE_KEY', { required: true });
    const gigalixirApp = core.getInput('GIGALIXIR_APP', { required: true });

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
    core.info(`The current release is ${currentRelease}`);

    await core.group("Deploying to gigalixir", async () => {
      await exec.exec("git push -f gigalixir HEAD:refs/heads/master");
    });

    await core.group("Adding private key to gigalixir", async () => {
      await exec.exec(path.join(__dirname, "../bin/add-private-key"), [sshPrivateKey]);
    });

    await core.group("Waiting for new release to deploy", async () => {
      await waitForNewRelease(currentRelease, gigalixirApp, 1);
    });

    try {
      core.group("Running migrations", async () => {
        await exec.exec(`gigalixir ps:migrate -a ${gigalixirApp}`)
      });
    } catch (error) {
      core.warning(`Migration failed, rolling back to the previous release: ${currentRelease}`);
      await core.group("Rolling back", async () => {
        await exec.exec(`gigalixir releases:rollback -a ${gigalixirApp}`)
      });

      core.setFailed(error.message);
    }
  } 
  catch (error) {
    core.setFailed(error.message);
  }
}

run();
