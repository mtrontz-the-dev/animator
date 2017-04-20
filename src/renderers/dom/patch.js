var updateElement = require('./updateElement')

function clone(a) {
  var o = {}
  for (var key in a) o[key] = a[key]
  return o
}

function getElementByFlexId (topLevelDomElement, flexId, scopes) {
  if (!scopes.elementCache) scopes.elementCache = {}
  if (scopes.elementCache[flexId]) return scopes.elementCache[flexId]
  var attrSelector = '[haiku-id="' + flexId + '"]'
  var elByHaikuId = topLevelDomElement.ownerDocument.querySelector(attrSelector)
  if (elByHaikuId) {
    scopes.elementCache[flexId] = elByHaikuId
    return scopes.elementCache[flexId]
  }
  var elById = topLevelDomElement.ownerDocument.getElementById(flexId)
  if (elById) {
    scopes.elementCache[flexId] = elById
    return scopes.elementCache[flexId]
  }
}

function patch (topLevelDomElement, virtualContainer, patchesDict, locator, hash, options, scopes) {
  options = clone(options)
  options._patch = true // Flag this as a patch so downstream knows not to clobber missing elements

  if (Object.keys(patchesDict) < 1) return topLevelDomElement
  for (var flexId in patchesDict) {
    var virtualElement = patchesDict[flexId]

    if (virtualElement && options.modifier) {
      var virtualReplacement = options.modifier(virtualElement)
      if (virtualReplacement !== undefined) {
        virtualElement = virtualReplacement
      }
    }

    var domElement = getElementByFlexId(topLevelDomElement, flexId, scopes)
    if (domElement) {
      updateElement(domElement, virtualElement, domElement.parentNode, virtualElement.__parent, domElement.haiku.locator, hash, options, scopes)
    }
  }
}

module.exports = patch
