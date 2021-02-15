module.exports =
/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 842:
/***/ ((__unused_webpack_module, __unused_webpack_exports, __nccwpck_require__) => {

const core = __nccwpck_require__(833);
const exec = __nccwpck_require__(671);
const path = __nccwpck_require__(622);

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

async function run() {
  try {
    const baseInputOptions = {
      required: true
    };
    const gigalixirUsername = core.getInput('GIGALIXIR_USERNAME', baseInputOptions);
    const gigalixirPassword = core.getInput('GIGALIXIR_PASSWORD', baseInputOptions);
    const sshPrivateKey = core.getInput('SSH_PRIVATE_KEY', baseInputOptions);
    const gigalixirApp = core.getInput('GIGALIXIR_APP', baseInputOptions);
    const migrations = core.getInput('MIGRATIONS', baseInputOptions);

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


/***/ }),

/***/ 833:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 671:
/***/ ((module) => {

module.exports = eval("require")("@actions/exec");


/***/ }),

/***/ 622:
/***/ ((module) => {

"use strict";
module.exports = require("path");;

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		if(__webpack_module_cache__[moduleId]) {
/******/ 			return __webpack_module_cache__[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	__nccwpck_require__.ab = __dirname + "/";/************************************************************************/
/******/ 	// module exports must be returned from runtime so entry inlining is disabled
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	return __nccwpck_require__(842);
/******/ })()
;