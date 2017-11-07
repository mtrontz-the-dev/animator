const async = require('async')
const cp = require('child_process')
const lodash = require('lodash')

const log = require('./log')

const allDeps = lodash.map(require('./allPackages')(), (pack) => pack.name)

module.exports = {
  unlinkDeps: function yarnUnlink (packages, cb) {
    async.each(packages, function (pack, next) {
      if (!pack.pkg) {
        next()
        return
      }

      const depTypes = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
      async.each(allDeps, (depName, next) => {
        async.each(depTypes, (depType, nextDepType) => {
          if (!pack.pkg[depType] || !pack.pkg[depType][depName]) {
            nextDepType()
            return
          }

          log.log('yarn unlinking ' + depName + ' from project ' + pack.name)
          cp.exec('yarn unlink ' + depName, {cwd: pack.abspath}, nextDepType)
        }, next)
      }, next)
    }, function (err) {
      if (err) {
        throw err
      }

      cb()
    })
  }
}
