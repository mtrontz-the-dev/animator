var getTimelineMaxTime = require('./getTimelineMaxTime')

module.exports = function getMaximumMs (reifiedBytecode, timelineName) {
  if (!reifiedBytecode) {
    return 0
  }
  if (!reifiedBytecode.timelines) {
    return 0
  }
  if (!reifiedBytecode.timelines[timelineName]) {
    return 0
  }
  return getTimelineMaxTime(reifiedBytecode.timelines[timelineName])
}