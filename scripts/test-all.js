const async = require('async');
const cp = require('child_process');
const path = require('path');
const log = require('./helpers/log');
const gitStatusInfo = require('./helpers/gitStatusInfo');
const allPackages = require('./helpers/packages')();

const ROOT = path.join(__dirname, '..');

async.eachSeries(allPackages, (pack, next) => {
  if (pack.pkg.scripts && pack.pkg.scripts.test) {
    if (pack.pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
      try {
        log.log(`running tests in ${pack.name}`);
        cp.execSync('yarn run test', {cwd: pack.abspath, stdio: 'inherit'});
      } catch (exception) {
        log.err(exception.message);
      }
    }
  }
  return next();
}, () => {
  const monoStatus = gitStatusInfo(ROOT);
  delete monoStatus.output;
  const statStr = JSON.stringify(monoStatus, null, 2);
  log.hat(`Here's what things look like in mono now:\n${statStr}\n(This is just FYI. An empty object is ok too.)`);
});
