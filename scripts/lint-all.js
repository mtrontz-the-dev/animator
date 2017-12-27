var async = require('async')
var cp = require('child_process')
var path = require('path')
var log = require('./helpers/log')
var gitStatusInfo = require('./helpers/gitStatusInfo')
var allPackages = require('./helpers/packages')()
var ROOT = path.join(__dirname, '..')

async.eachSeries(allPackages, function (pack, next) {
  if (pack.pkg.scripts) {
    const command = pack.pkg.scripts.fix || pack.pkg.scripts.lint
    if (command) {
      try {
        log.log('linting ' + pack.name)
        cp.execSync(command, { cwd: pack.abspath, stdio: 'inherit' })
      } catch (exception) {
        log.err(exception.message)
      }
    }
  }
  return next()
}, () => {
  var monoStatus = gitStatusInfo(ROOT)
  delete monoStatus.output
  var statStr = JSON.stringify(monoStatus, null, 2)
  log.hat(`Here's what things look like in mono now:\n${statStr}\n(This is just FYI. An empty object is ok too.)`)
})
