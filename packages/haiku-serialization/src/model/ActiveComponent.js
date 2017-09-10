var path = require('path')
var util = require('util')
var EventEmitter = require('events').EventEmitter
var lodash = require('lodash')
var raf = require('raf')
var Element = require('./Element')
var Timeline = require('./Timeline')
var FileModel = require('./File')
var visitTemplate = require('./helpers/visitTemplate')
var getHaikuKnownImportMatch = require('./getHaikuKnownImportMatch')
var overrideModulesLoaded = require('./../utils/overrideModulesLoaded')
var EnvoyClient = require('haiku-sdk-creator/lib/envoy/client').default

if (typeof WebSocket === 'undefined') { // eslint-disable-line
  var WebSocket = require('ws')
}

var HAIKU_ID_ATTRIBUTE = 'haiku-id'
var DEFAULT_SCENE_NAME = 'main' // e.g. code/main/*
var DEFAULT_INTERACTION_MODE = {
  type: 'edit' // I.e., the player shouldn't respond to events, etc. (live/edit)
}

function _getDefinedKeys (obj) {
  var fullKeys = Object.keys(obj)
  return lodash.filter(fullKeys, (key) => {
    return obj[key]
  })
}

function info () {
  console.log.apply(console, arguments)
}

function toast (msg) {
  console.info('[notice] ' + msg)
}

/**
 * @class ActiveComponent
 * @description Encapsulates and consolidates code to edit a live in-stage component.
 * @param options {Object} Object of configurable options
 * @param options.alias {String} Name of instance used for routing, e.g. 'timeline'
 * @param options.folder {String} Absolute path to project folder being edited
 * @param options.userconfig {String} Configuration defined in project's haiku.js
 * @param options.websocket {Object} WebSocket client object, usually passed in from React
 * @param options.platform {Object} Object representing render platform, e.g. window
 * @param options.file {Object} File or options object to override File model options
 */
function ActiveComponent (options) {
  EventEmitter.apply(this)

  this.alias = options.alias
  this.folder = options.folder

  this.scenename = DEFAULT_SCENE_NAME
  this.userconfig = options.userconfig
  this.websocket = options.websocket
  this.platform = options.platform

  var _FileModel = FileModel(this.userconfig || {})

  // Primarily a testing hook - don't remove unless you want tests to break
  // -- Actually this is also used as part of MasterProcess's bootstrapping
  this.FileModel = _FileModel

  _FileModel.findOrCreate(lodash.assign({}, {
    folder: this.folder,
    relpath: this._getSceneCodePath(),
    type: _FileModel.TYPES.code,
    dtModified: Date.now(),
    contents: null,
    previous: null,
    substructs: [], // We will populate this a bit later (see below)
    ast: null, // By default, don't need to do AST manip (overridden in MasterProcess)
    doShallowWorkOnly: true, // By default, don't do fs, ast, or code updates (overridden in MasterProcess)
    skipDiffLogging: true, // By default don't diff log (overridden in MasterProcess)
    hostInstance: {}, // Assigned later; used for dynamic computation of values during live editing
    states: {} // ditto
  }, options.file || {}), function (err, file) {
    if (err) return console.error(err)
    info('[active component] active bytecode file loaded via ' + file.get('relpath'))
  })

  this._componentInstance = null // ::HaikuComponent
  this._mount = null // Optional storage for a mount DOM element which the player needs to run

  this._currentTimelineName = 'Default'
  this._currentTimelineTime = 0
  this._timelines = Timeline(this)
  this._timelines.on('timeline:tick', (currentFrame) => {
    this.emit('timeline:tick', currentFrame)
  })

  // Super hack, but it turns out we need to have this in a LOT of places in order for routing to work
  // and not end up with infinite loops of events emitted, captured, and emitted again. Beware!
  this._metadata = { from: this.alias }

  this._elements = Element(this.platform, this, this._metadata)
  this._elements.on('element:copy', (componentId) => {
    this.emit('element:copy', componentId)
  })

  if (!this.platform.haiku) this.platform.haiku = {}
  if (!this.platform.haiku.registry) this.platform.haiku.registry = {}
  this.platform.haiku.registry[path.join(this.folder, this._getSceneCodePath())] = this

  this._propertyGroupBatches = {}
  this._selectedElements = {} // Local tracking of whose selection status did/didn't change

  // Used to control how we render in an editing environment, e.g. preview mode
  this._interactionMode = DEFAULT_INTERACTION_MODE

  this._envoyClient = new EnvoyClient(lodash.assign({
    WebSocket: WebSocket
  }, options.envoy))

  this._envoyClient.get('timeline').then((timelineChannel) => {
    this._envoyTimelineChannel = timelineChannel
    this.emit('envoy:timelineClientReady', this._envoyTimelineChannel)
  })

  clientFactory.get("/tour").then((client) => {
    client.requestWebviewCoordinates().then(() => {
      this.emit("envoy:tourClientReady", client)
    })
  })
}

util.inherits(ActiveComponent, EventEmitter)

ActiveComponent.prototype._getSceneCodePath = function _getSceneCodePath () {
  return path.join('code', this.scenename, 'code.js')
}

ActiveComponent.prototype._getSceneDomModulePath = function _getSceneDomModulePath () {
  return path.join('code', this.scenename, 'dom.js')
}

ActiveComponent.prototype._setSceneName = function _setSceneName (scenename) {
  this._scenename = scenename
  return this
}

ActiveComponent.prototype.fetchActiveBytecodeFile = function fetchActiveBytecodeFile () {
  return this.FileModel.findFile(this._getSceneCodePath())
}

ActiveComponent.prototype._afterRequestWrapped = function _afterRequestWrapped (cb, err) {
  if (err) {
    console.error(err)
    return cb(err)
  }
  return cb()
}

ActiveComponent.prototype._createChangeCallback = function _createChangeCallback (cb, maybeComponentIds, maybeTimelineName, maybeTimelineTime, maybePropertyNames, maybeMetadata) {
  return function (err) {
    if (err) return this._afterRequestWrapped(cb, err)
    // For the player to work after update, we need to update each timeline object's 'max time'
    // This is a caching optimization the player uses to avoid wasting cycles
    this._updateTimelineMaxes(this._currentTimelineName)

    // Notify the timeline that we have updated so it knows to flush its caches
    this.emit('component:updated', maybeComponentIds, maybeTimelineName, maybeTimelineTime, maybePropertyNames, maybeMetadata)

    return this._afterRequestWrapped(cb)
  }.bind(this)
}

ActiveComponent.prototype._clearCaches = function _clearCaches () {
  this._componentInstance._clearCaches() // Also clears builder sub-caches
  return this
}

ActiveComponent.prototype._clearCachedClusters = function _clearCachedClusters (timelineName, componentId) {
  this._componentInstance._builder._clearCachedClusters(timelineName, componentId)
  return this
}

ActiveComponent.prototype._hydrateElements = function _hydrateElements () {
  this._elements.clearCaches()
  visitTemplate(this._componentInstance._template, null, function _visitor (node, parent) {
    this._elements.upsertFromNodeWithComponent(node, parent, this, this._metadata)
  }.bind(this))
}

ActiveComponent.prototype._updateTimelineMaxes = function _updateTimelineMaxes (timelineName) {
  var timeline = this._componentInstance._timelineInstances[timelineName]
  if (!timeline) return this
  var descriptor = this._componentInstance._getTimelineDescriptor(timelineName)
  timeline._resetMaxDefinedTimeFromDescriptor(descriptor)
  return this
}

// Dynamic interface to make incoming websocket calls easier to route
ActiveComponent.prototype.callMethod = function callMethod (method, params, cb) {
  try {
    if (!this[method]) return cb(new Error('ActiveComponent: No such method ' + method))
    return this[method].apply(this, params.concat(cb))
  } catch (exception) {
    return cb(exception)
  }
}

ActiveComponent.prototype.getPropertyGroupValue = function getPropertyGroupValue (componentId, timelineName, timelineTime, propertyKeys) {
  var groupValue = {}
  var bytecode = this.fetchActiveBytecodeFile().get('substructs')[0].bytecode
  if (!bytecode) return groupValue
  if (!bytecode.timelines) return groupValue
  if (!bytecode.timelines[timelineName]) return groupValue
  if (!bytecode.timelines[timelineName][`haiku:${componentId}`]) return groupValue
  var cluster = bytecode.timelines[timelineName][`haiku:${componentId}`]
  propertyKeys.forEach((propertyKey) => {
    if (!cluster[propertyKey]) return void (0)
    if (!cluster[propertyKey][timelineTime]) return void (0)
    groupValue[propertyKey] = cluster[propertyKey][timelineTime].value
  })
  return groupValue
}

ActiveComponent.prototype.getMountHTML = function () {
  var mount = this.getMount()
  if (!mount) return ''
  return mount.innerHTML
}

ActiveComponent.prototype._forceFlush = function _forceFlush () {
  if (this._componentInstance) {
    this._componentInstance._markForFullFlush(true)
    // This guard is to allow headless mode, e.g. in Haiku's timeline application
    if (this._componentInstance._context && this._componentInstance._context.tick) {
      this._componentInstance._context.tick()
    }
  }
}

ActiveComponent.prototype._setTimelineTimeValue = function _setTimelineTimeValue (timelineTime) {
  timelineTime = Math.round(timelineTime)

  this._currentTimelineTime = timelineTime

  if (this._componentInstance) { // This may end up getting called before we've fully initialized #RC
    var time = this._componentInstance._context.clock.getExplicitTime()

    var timelines = this._componentInstance._timelineInstances

    for (var localTimelineName in timelines) {
      if (localTimelineName !== this._currentTimelineName) continue
      var timeline = timelines[this._currentTimelineName]

      if (timeline.isActive()) {
        timeline._controlTime(timelineTime, time)
      }
    }
  }
}

ActiveComponent.prototype.setTimelineTime = function setTimelineTime (timelineTime, metadata, cb) {
  this._setTimelineTimeValue(timelineTime)
  this._forceFlush()
  this.emit('time:change', this._currentTimelineName, this._currentTimelineTime)
  return this._afterRequestWrapped(cb)
}

ActiveComponent.prototype.setTimelineName = function setTimelineName (timelineName, metadata, cb) {
  info('[active component] changing active timeline to ' + timelineName)

  this._currentTimelineName = timelineName

  this._componentInstance.stopAllTimelines()
  this._componentInstance.startTimeline(timelineName)

  return this._afterRequestWrapped(cb)
}

/**
 * @method _elementWasSelected
 * @description Hook to call once an element in-memory has been selected.
 * This is responsible for notifying other views about the action, and emitting an event that others can listen to.
 * The metadata arg is important because it has info about who originated the message, allowing us to avoid infinite loop.
 * Note: This gets called automatically by element.select()
 */
ActiveComponent.prototype._elementWasSelected = function _elementWasSelected (componentId, metadata, cb) {
  // Views can listen to this to trigger selection event in other views (or to control top menu items)
  this.emit('element:selected', componentId)

  // We keep a list of all selected elements so they can all be moved in tandem, etc
  this._selectedElements[componentId] = true

  // If we originated the selection, notify all other views that it occurred
  if (metadata.from === this.alias) {
    this.websocket.send({ type: 'action', method: 'selectElement', params: [this.folder, componentId] })
  }

  // #FIXME Not sure if everbody is polite enough to pass this callback, hence the conditional...
  if (cb) return cb()
}

/**
 * @method _elementWasUnselected
 * @description Hook to call once an element in-memory has been unselected.
 * This is responsible for notifying other views about the action, and emitting an event that others can listen to.
 * The metadata arg is important because it has info about who originated the message, allowing us to avoid infinite loop.
 * Note: This gets called automatically by element.unselect()
 */
ActiveComponent.prototype._elementWasUnselected = function _elementWasUnselected (componentId, metadata, cb) {
  // Only do expensive unselect actions (e.g., sending message to comlink) if it was *already* selected
  if (this._selectedElements[componentId]) {
    // Views can listen to this to trigger selection event in other views (or to control top menu items)
    this.emit('element:unselected', componentId)

    // We keep a list of all selected elements so they can all be moved in tandem, etc
    this._selectedElements[componentId] = false

    // If we originated the selection, notify all other views that it occurred
    if (metadata.from === this.alias) {
      this.websocket.send({ type: 'action', method: 'unselectElement', params: [this.folder, componentId] })
    }
  }

  // #FIXME Not sure if everbody is polite enough to pass this callback, hence the conditional...
  if (cb) return cb()
}

/** ------------ */
/** ------------ */
/** ------------ */

ActiveComponent.prototype.setInteractionMode = function setInteractionMode (modeOptions, metadata, cb) {
  this._interactionMode = modeOptions || DEFAULT_INTERACTION_MODE
  if (metadata.from === this.alias) {
    this.websocket.send({ type: 'action', method: 'setInteractionMode', params: [this.folder, modeOptions] })
  }
  this._componentInstance.assignConfig({
    options: {
      interactionMode: this._interactionMode
    }
  })
  this._clearCaches()
  this._forceFlush()
  return cb()
}

ActiveComponent.prototype.selectElement = function selectElement (componentId, metadata, cb) {
  this._elements.selectElementByComponentId(componentId, metadata)
  return cb() // MUST return or the websocket action circuit never completes
}

ActiveComponent.prototype.unselectElement = function unselectElement (componentId, metadata, cb) {
  this._elements.unselectElementByComponentId(componentId, metadata)
  return cb() // MUST return or the websocket action circuit never completes
}

ActiveComponent.prototype.gitUndo = function gitUndo (options, metadata, cb) {
  return cb()
}

ActiveComponent.prototype.gitRedo = function gitRedo (options, metadata, cb) {
  return cb()
}

var _stageTransform = {zoom: 1, pan: {x: 0, y: 0}}
ActiveComponent.prototype.setStageTransform = function setStageTransform (newTransform) {
  _stageTransform = newTransform
}

ActiveComponent.prototype.getStageTransform = function getStageTransform () {
  return _stageTransform
}

ActiveComponent.prototype.instantiateComponent = function instantiateComponent (relpath, posdata, metadata, cb) {
  var coords = {}
  if (posdata.x !== undefined) coords.x = posdata.x
  if (posdata.y !== undefined) coords.y = posdata.y
  if (posdata.minimized) coords.minimized = posdata.minimized

  var mount = this.getMount()
  if (mount) {
    var bounds = mount.getBoundingClientRect()
    if (posdata.offsetX) coords.x = posdata.offsetX - bounds.left
    if (posdata.offsetY) coords.y = posdata.offsetY - bounds.top
  }

  // account for stage transform
  coords.x *= 1 / _stageTransform.zoom
  coords.y *= 1 / _stageTransform.zoom

  this.fetchActiveBytecodeFile().instantiateComponent(relpath, coords, function _instantiatecb (err, mana) {
    this._clearCaches()
    this._forceFlush()
    this._hydrateElements()

    if (err) {
      return cb(err)
    }

    var componentId = mana.attributes[HAIKU_ID_ATTRIBUTE]

    if (metadata.from === this.alias) {
      this.websocket.send({ type: 'action', method: 'instantiateComponent', params: [this.folder, relpath, posdata] })
    }
    return raf(function _rafcb () {
      // For instantiation, we unselect everything except the selected element:
      this._elements.unselectAllElements(metadata)
      this._selectedElements = {}
      this._elements.selectElementByComponentId(componentId, metadata)

      this.emit('component:updated', null, null, null, null, metadata)

      cb(null, { center: coords }, this._elements.where({ isSelected: true })[0])
    }.bind(this))
  }.bind(this))
}

ActiveComponent.prototype.deleteComponent = function deleteComponent (componentIds, metadata, cb) {
  this.fetchActiveBytecodeFile().deleteComponent(componentIds, this._createChangeCallback((err) => {
    this._clearCaches()
    this._forceFlush()
    this._hydrateElements()

    if (err) return cb(err)
    if (metadata.from === this.alias) {
      this.websocket.send({ type: 'action', method: 'deleteComponent', params: [this.folder, componentIds] })
    }
    return cb()
  }, null, null, null, null, metadata))
}

ActiveComponent.prototype.mergeDesign = function mergeDesign (timelineName, timelineTime, relpath, metadata, cb) {
  this.fetchActiveBytecodeFile().mergeDesign(timelineName, timelineTime, relpath, this._createChangeCallback((err) => {
    this._clearCaches()
    this._forceFlush()
    this._hydrateElements()
    if (err) return cb(err)
    if (metadata.from === this.alias) {
      this.websocket.send({ type: 'action', method: 'mergeDesign', params: [this.folder, timelineName, timelineTime, relpath] })
    }
    return cb()
  }, null, timelineName, timelineTime, null, metadata))
}

ActiveComponent.prototype.applyPropertyValue = function applyPropertyValue (componentIds, timelineName, timelineTime, propertyName, propertyValue, metadata, cb) {
  this.fetchActiveBytecodeFile().applyPropertyValue(componentIds, timelineName, timelineTime, propertyName, propertyValue, this._createChangeCallback(cb, componentIds, timelineName, timelineTime, [propertyName], metadata))
}

ActiveComponent.prototype.applyPropertyDelta = function applyPropertyDelta (componentIds, timelineName, timelineTime, propertyName, propertyValue, metadata, cb) {
  this.fetchActiveBytecodeFile().applyPropertyDelta(componentIds, timelineName, timelineTime, propertyName, propertyValue, this._createChangeCallback(cb, componentIds, timelineName, timelineTime, [propertyName], metadata))
}

ActiveComponent.prototype.applyPropertyGroupValue = function applyPropertyGroupValue (componentIds, timelineName, timelineTime, propertyGroup, metadata, cb) {
  this.fetchActiveBytecodeFile().applyPropertyGroupValue(componentIds, timelineName, timelineTime, propertyGroup, this._createChangeCallback(cb, componentIds, timelineName, timelineTime, _getDefinedKeys(propertyGroup), metadata))
}

ActiveComponent.prototype.applyPropertyGroupDelta = function applyPropertyGroupDelta (componentIds, timelineName, timelineTime, propertyGroup, metadata, cb) {
  this.fetchActiveBytecodeFile().applyPropertyGroupDelta(componentIds, timelineName, timelineTime, propertyGroup, this._createChangeCallback((err) => {
    if (err) return cb(err)
    if (metadata.from === this.alias) {
      componentIds.forEach((componentId) => {
        this.batchPropertyGroupUpdate(componentId, this._currentTimelineName, this._currentTimelineTime, _getDefinedKeys(propertyGroup))
      })
    }
    return cb()
  }, componentIds, timelineName, timelineTime, _getDefinedKeys(propertyGroup), metadata))
}

ActiveComponent.prototype.getContextSize = function getContextSize () {
  return this.fetchActiveBytecodeFile().getContextSize(this._currentTimelineName, this._currentTimelineTime)
}

ActiveComponent.prototype.resizeContext = function resizeContext (artboardIds, timelineName, timelineTime, sizeDescriptor, metadata, cb) {
  this.fetchActiveBytecodeFile().resizeContext(artboardIds, timelineName, timelineTime, sizeDescriptor, this._createChangeCallback((err) => {
    if (err) return cb(err)
    this.emit('artboard:resized', sizeDescriptor)
    if (metadata.from === this.alias) {
      artboardIds.forEach((artboardId) => {
        this.batchPropertyGroupUpdate(artboardId, timelineName, timelineTime, ['sizeAbsolute.x', 'sizeAbsolute.y'])
      })
    }
    return cb()
  }, artboardIds, timelineName, timelineTime, ['sizeAbsolute.x', 'sizeAbsolute.y'], metadata))
}

// ------***

ActiveComponent.prototype.changeKeyframeValue = function (componentIds, timelineName, propertyName, keyframeMs, newValue, metadata, cb) {
  componentIds.forEach((componentId) => { this._clearCachedClusters(this._currentTimelineName, componentId) })
  return this.fetchActiveBytecodeFile().changeKeyframeValue(componentIds, timelineName, propertyName, keyframeMs, newValue, this._createChangeCallback(cb, componentIds, timelineName, keyframeMs, [propertyName], metadata))
}

ActiveComponent.prototype.changePlaybackSpeed = function (framesPerSecond, metadata, cb) {
  return this.fetchActiveBytecodeFile().changePlaybackSpeed(framesPerSecond, this._createChangeCallback(cb))
}

ActiveComponent.prototype.changeSegmentCurve = function (componentIds, timelineName, propertyName, keyframeMs, newCurve, metadata, cb) {
  componentIds.forEach((componentId) => { this._clearCachedClusters(this._currentTimelineName, componentId) })
  return this.fetchActiveBytecodeFile().changeSegmentCurve(componentIds, timelineName, propertyName, keyframeMs, newCurve, this._createChangeCallback(cb, componentIds, timelineName, null, [propertyName], metadata))
}

ActiveComponent.prototype.changeSegmentEndpoints = function (componentIds, timelineName, propertyName, oldMs, newMs, metadata, cb) {
  componentIds.forEach((componentId) => { this._clearCachedClusters(this._currentTimelineName, componentId) })
  return this.fetchActiveBytecodeFile().changeSegmentEndpoints(componentIds, timelineName, propertyName, oldMs, newMs, this._createChangeCallback(cb, componentIds, timelineName, null, [propertyName], metadata))
}

ActiveComponent.prototype.createKeyframe = function (componentIds, timelineName, elementName, propertyName, keyframeStartMs, keyframeValue, keyframeCurve, keyframeEndMs, keyframeEndValue, metadata, cb) {
  componentIds.forEach((componentId) => { this._clearCachedClusters(this._currentTimelineName, componentId) })
  return this.fetchActiveBytecodeFile().createKeyframe(componentIds, timelineName, elementName, propertyName, keyframeStartMs, keyframeValue, keyframeCurve, keyframeEndMs, keyframeEndValue, this._createChangeCallback((err) => {
    if (err) return cb(err)
    this._clearCaches()
    return cb()
  }, componentIds, timelineName, keyframeStartMs, [propertyName], metadata))
}

ActiveComponent.prototype.createTimeline = function (timelineName, timelineDescriptor, metadata, cb) {
  return this.fetchActiveBytecodeFile().createTimeline(timelineName, timelineDescriptor, this._createChangeCallback(cb, null, timelineName, null, null, metadata))
}

ActiveComponent.prototype.deleteKeyframe = function (componentIds, timelineName, propertyName, keyframeMs, metadata, cb) {
  componentIds.forEach((componentId) => { this._clearCachedClusters(this._currentTimelineName, componentId) })
  return this.fetchActiveBytecodeFile().deleteKeyframe(componentIds, timelineName, propertyName, keyframeMs, this._createChangeCallback(cb, componentIds, timelineName, keyframeMs, [propertyName], metadata))
}

ActiveComponent.prototype.deleteTimeline = function (timelineName, metadata, cb) {
  return this.fetchActiveBytecodeFile().deleteTimeline(timelineName, this._createChangeCallback(cb, null, timelineName, null, null, metadata))
}

ActiveComponent.prototype.duplicateTimeline = function (timelineName, metadata, cb) {
  return this.fetchActiveBytecodeFile().duplicateTimeline(timelineName, this._createChangeCallback(cb, null, timelineName, null, null, metadata))
}

ActiveComponent.prototype.joinKeyframes = function (componentIds, timelineName, elementName, propertyName, keyframeMsLeft, keyframeMsRight, newCurve, metadata, cb) {
  componentIds.forEach((componentId) => { this._clearCachedClusters(this._currentTimelineName, componentId) })
  return this.fetchActiveBytecodeFile().joinKeyframes(componentIds, timelineName, elementName, propertyName, keyframeMsLeft, keyframeMsRight, newCurve, this._createChangeCallback(cb, componentIds, timelineName, keyframeMsLeft, [propertyName], metadata))
}

ActiveComponent.prototype.moveSegmentEndpoints = function (componentIds, timelineName, propertyName, handle, keyframeIndex, startMs, endMs, frameInfo, metadata, cb) {
  componentIds.forEach((componentId) => { this._clearCachedClusters(this._currentTimelineName, componentId) })
  return this.fetchActiveBytecodeFile().moveSegmentEndpoints(componentIds, timelineName, propertyName, handle, keyframeIndex, startMs, endMs, frameInfo, this._createChangeCallback(cb, componentIds, timelineName, startMs, [propertyName], metadata))
}

ActiveComponent.prototype.moveKeyframes = function (componentIds, timelineName, propertyName, keyframeMoves, frameInfo, metadata, cb) {
  componentIds.forEach((componentId) => { this._clearCachedClusters(this._currentTimelineName, componentId) })
  return this.fetchActiveBytecodeFile().moveKeyframes(componentIds, timelineName, propertyName, keyframeMoves, frameInfo, this._createChangeCallback(cb, componentIds, timelineName, null, [propertyName], metadata))
}

ActiveComponent.prototype.renameTimeline = function (timelineNameOld, timelineNameNew, metadata, cb) {
  return this.fetchActiveBytecodeFile().renameTimeline(timelineNameOld, timelineNameNew, this._createChangeCallback(cb))
}

ActiveComponent.prototype.sliceSegment = function (componentIds, timelineName, elementName, propertyName, keyframeMs, sliceMs, metadata, cb) {
  componentIds.forEach((componentId) => { this._clearCachedClusters(this._currentTimelineName, componentId) })
  return this.fetchActiveBytecodeFile().sliceSegment(componentIds, timelineName, elementName, propertyName, keyframeMs, sliceMs, this._createChangeCallback(cb, componentIds, timelineName, keyframeMs, [propertyName], metadata))
}

ActiveComponent.prototype.splitSegment = function (componentIds, timelineName, elementName, propertyName, keyframeMs, metadata, cb) {
  componentIds.forEach((componentId) => { this._clearCachedClusters(this._currentTimelineName, componentId) })
  return this.fetchActiveBytecodeFile().splitSegment(componentIds, timelineName, elementName, propertyName, keyframeMs, this._createChangeCallback(cb, componentIds, timelineName, keyframeMs, [propertyName], metadata))
}

// -----***

ActiveComponent.prototype.zMoveToFront = function (componentIds, timelineName, timelineTime, metadata, cb) {
  this.fetchActiveBytecodeFile().zMoveToFront(componentIds, timelineName, timelineTime, this._createChangeCallback((err) => {
    if (err) return cb()
    if (metadata.from === this.alias) {
      this.websocket.send({ type: 'action', method: 'zMoveToFront', params: [this.folder, componentIds, timelineName, timelineTime] })
    }
    this._clearCaches()
    return cb()
  }, componentIds, timelineName, timelineTime, null, metadata))
}

ActiveComponent.prototype.zMoveForward = function (componentIds, timelineName, timelineTime, metadata, cb) {
  this.fetchActiveBytecodeFile().zMoveForward(componentIds, timelineName, timelineTime, this._createChangeCallback((err) => {
    if (err) return cb(err)
    if (metadata.from === this.alias) {
      this.websocket.send({ type: 'action', method: 'zMoveForward', params: [this.folder, componentIds, timelineName, timelineTime] })
    }
    this._clearCaches()
    return cb()
  }, componentIds, timelineName, timelineTime, null, metadata))
}

ActiveComponent.prototype.zMoveBackward = function (componentIds, timelineName, timelineTime, metadata, cb) {
  this.fetchActiveBytecodeFile().zMoveBackward(componentIds, timelineName, timelineTime, this._createChangeCallback((err) => {
    if (err) return cb(err)
    if (metadata.from === this.alias) {
      this.websocket.send({ type: 'action', method: 'zMoveBackward', params: [this.folder, componentIds, timelineName, timelineTime] })
    }
    this._clearCaches()
    return cb()
  }, componentIds, timelineName, timelineTime, null, metadata))
}

ActiveComponent.prototype.zMoveToBack = function (componentIds, timelineName, timelineTime, metadata, cb) {
  this.fetchActiveBytecodeFile().zMoveToBack(componentIds, timelineName, timelineTime, this._createChangeCallback((err) => {
    if (err) return cb(err)
    if (metadata.from === this.alias) {
      this.websocket.send({ type: 'action', method: 'zMoveToBack', params: [this.folder, componentIds, timelineName, timelineTime] })
    }
    this._clearCaches()
    return cb()
  }, componentIds, timelineName, timelineTime, null, metadata))
}

ActiveComponent.prototype.reorderElement = function (componentId, componentIdToInsertBefore, metadata, cb) {
  this._clearCachedClusters(this._currentTimelineName, componentId)
  this.fetchActiveBytecodeFile().reorderElement(componentId, componentIdToInsertBefore, this._createChangeCallback(cb, [componentId], null, null, null, metadata))
}

ActiveComponent.prototype.groupElements = function (componentIdsToGroup, metadata, cb) {
  componentIdsToGroup.forEach((componentId) => { this._clearCachedClusters(this._currentTimelineName, componentId) })
  this.fetchActiveBytecodeFile().groupElements(componentIdsToGroup, this._createChangeCallback(cb, componentIdsToGroup, null, null, null, metadata))
}

ActiveComponent.prototype.ungroupElements = function (groupComponentIds, metadata, cb) {
  groupComponentIds.forEach((componentId) => { this._clearCachedClusters(this._currentTimelineName, componentId) })
  this.fetchActiveBytecodeFile().ungroupElements(groupComponentIds, this._createChangeCallback(cb, groupComponentIds, null, null, null, metadata))
}

ActiveComponent.prototype.hideElements = function (componentIds, metadata, cb) {
  componentIds.forEach((componentId) => { this._clearCachedClusters(this._currentTimelineName, componentId) })
  this.fetchActiveBytecodeFile().hideElements(componentIds, metadata, this._createChangeCallback(cb, componentIds, null, null, null, metadata))
}

/**
 * @method pasteThing
 * @description Flexibly paste some content into the component. Usually the thing pasted is going to be a
 * component, but this could theoretically handle any kind of 'pasteable' content.
 * @param pasteable {Object} - Content of the thing to paste into the component.
 * @param request {Object} - Optional object containing information about _how_ to paste, e.g. coords
 * @param metadata {Object}
 */
ActiveComponent.prototype.pasteThing = function (pasteable, request, metadata, cb) {
  this.fetchActiveBytecodeFile().pasteThing(pasteable, request, function _pastecb (err) {
    this._clearCaches()
    this._forceFlush()
    this._hydrateElements()
    if (err) return cb(err)
    return raf(function _rafcb () {
      cb()

      // QUESTION: Do we need this?:
      // cb(null, { center: coords })
      // Should this have the same logic we use for instantiation? (probably yes)

      this.emit('component:updated', null, null, null, null, metadata)
    }.bind(this))
  }.bind(this))
}

/**
 * @method deleteThing
 * @description Flexibly delete some content into the component. Usually the thing deleted is going to be a
 * component, but this could theoretically handle any kind of 'deleteable' content.
 * @param deleteable {Object} - Content of the thing to delete into the component.
 * @param metadata {Object}
 */
ActiveComponent.prototype.deleteThing = function (deletable, metadata, cb) {
  this.fetchActiveBytecodeFile().deleteThing(deletable, this._createChangeCallback(cb, null, null, null, null, metadata))
}

/**
 * @method readAllStateValues
 */
ActiveComponent.prototype.readAllStateValues = function readAllStateValues (metadata, cb) {
  return this.fetchActiveBytecodeFile().readAllStateValues(cb)
}

/**
 * @method upsertStateValue
 */
ActiveComponent.prototype.upsertStateValue = function upsertStateValue (stateName, stateDescriptor, metadata, cb) {
  return this.fetchActiveBytecodeFile().upsertStateValue(stateName, stateDescriptor, this._createChangeCallback((err) => {
    if (err) return cb(err)
    if (metadata.from === this.alias) {
      this.websocket.send({ type: 'action', method: 'upsertStateValue', params: [this.folder, stateName, stateDescriptor] })
    }
    this._clearCaches()
    return cb()
  }, null, null, null, null, metadata))
}

/**
 * @method deleteStateValue
 */
ActiveComponent.prototype.deleteStateValue = function deleteStateValue (stateName, metadata, cb) {
  return this.fetchActiveBytecodeFile().deleteStateValue(stateName, this._createChangeCallback((err) => {
    if (err) return cb(err)
    if (metadata.from === this.alias) {
      this.websocket.send({ type: 'action', method: 'deleteStateValue', params: [this.folder, stateName] })
    }
    this._clearCaches()
    return cb()
  }, null, null, null, null, metadata))
}

/**
 * @method readAllEventHandlers
 */
ActiveComponent.prototype.readAllEventHandlers = function readAllEventHandlers (metadata, cb) {
  return this.fetchActiveBytecodeFile().readAllEventHandlers(cb)
}

/**
 * @method upsertEventHandler
 */
ActiveComponent.prototype.upsertEventHandler = function upsertEventHandler (selectorName, eventName, handlerDescriptor, metadata, cb) {
  return this.fetchActiveBytecodeFile().upsertEventHandler(selectorName, eventName, handlerDescriptor, this._createChangeCallback((err) => {
    if (err) return cb(err)
    if (metadata.from === this.alias) {
      this.websocket.send({ type: 'action', method: 'upsertEventHandler', params: [this.folder, selectorName, eventName, handlerDescriptor] })
    }
    this._clearCaches()
    return cb()
  }, null, null, null, null, metadata))
}

/**
 * @method deleteEventHandler
 */
ActiveComponent.prototype.deleteEventHandler = function deleteEventHandler (selectorName, eventName, metadata, cb) {
  return this.fetchActiveBytecodeFile().deleteEventHandler(selectorName, eventName, this._createChangeCallback((err) => {
    if (err) return cb(err)
    if (metadata.from === this.alias) {
      this.websocket.send({ type: 'action', method: 'deleteEventHandler', params: [this.folder, selectorName, eventName] })
    }
    this._clearCaches()
    return cb()
  }, null, null, null, null, metadata))
}

/** ------------ */
/** ------------ */
/** ------------ */

/**
 * @method reloadComponent
 * @description Force reload the component player using the JavaScript module system. This includes an override
 * step that ensures that the _local-to-Haiku-desktop_ variant of the Haiku Player is loaded instead of whatever
 * version may defined in the user's project. Also note that this clears the require cache (expensive) since the
 * changed contents wouldn't be loaded in otherwise.
 */
ActiveComponent.prototype.reloadComponent = function reloadComponent (cb) {
  var modulePath = path.join(this.folder, this._getSceneDomModulePath())

  info('[active component] clearing require cache')

  for (var key in require.cache) {
    if (!key.match(/node_modules/)) delete require.cache[key]
  }

  info('[active component] overriding loaded modules')

  overrideModulesLoaded((stop) => {
    info('[active component] reloading module (' + modulePath + ')')

    var updatedHaikuComponentFactory = require(modulePath)

    stop() // Tell the node hook to stop interfering since we've got what we need now

    info('[active component] module reload complete (' + modulePath + ')')

    return cb(null, updatedHaikuComponentFactory)
  }, getHaikuKnownImportMatch)

  return this
}

ActiveComponent.prototype.setMount = function setMount (mount) {
  this._mount = mount
  return this
}

ActiveComponent.prototype.getMount = function getMount () {
  return this._mount
}

/**
 * @method mountApplication
 * @description Given an *optional* DOM element to mount, load the component and boostrap it inside the mount.
 * If no mount is provided (i.e. in non-DOM contexts) this method can also be used if you just want to reload
 * the data for the component instead of actually displaying it. This is used by the Timeline but also nominally
 * by the Glass.
 */
ActiveComponent.prototype.mountApplication = function mountApplication (mount, config) {
  // Allow headless, e.g. in plumbing or timeline
  this.setMount(mount)

  raf(() => {
    return this.reloadComponent((err, updatedHaikuComponentFactory) => {
      if (err) return this.emit('error', err)

      try {
        this._componentInstance = updatedHaikuComponentFactory(this.getMount(), lodash.assign({}, {
          options: {
            // Don't show the right-click context menu since our editing tools make use of right-click
            contextMenu: 'disabled',
            overflowX: 'visible',
            overflowY: 'visible',
            // Don't track events in mixpanel while the component is being built
            mixpanel: false,
            interactionMode: this._interactionMode
          }
        }, config))

        // Make sure we get notified of state updates and everything else we care about
        this._componentInstance._doesEmitEventsVerbosely = true
        this._componentInstance.on('state:set', function _stateSetCb (stateName, stateValue) {
          this.websocket.send({ type: 'broadcast', name: 'state:set', params: [this.folder, stateName, stateValue] })
        }.bind(this))

        // These are used at Haiku Desktop runtime for live editing, e.g. if you change a value we need to compute
        // the previous for interpolation, but since that might be dynamic, we need the full instance
        this.fetchActiveBytecodeFile().set('hostInstance', this._componentInstance)
        this.fetchActiveBytecodeFile().set('states', this._componentInstance._states)

        // Update the entire bytecode object pointer otherwise some updates might not touch the right properties.
        // This also clears all the caches.
        this.rehydrateBytecode(this._componentInstance._bytecode, this._componentInstance._template)

        // Lock the time to zero since we are inside 'control' mode
        var globalTime = this._componentInstance._context.clock.getExplicitTime()
        var timelines = this._componentInstance._timelineInstances
        for (var timelineName in timelines) {
          var timeline = timelines[timelineName]
          timeline._controlTime(0, globalTime)
        }

        // Gotta do this after the tree has populated for the first time
        raf(() => {
          this._hydrateElements()

          // Wait until after we've hydrated elements to toggle this since the listeners might want access to the elements
          this._isMounted = true
          this.emit('component:mounted')
        })
      } catch (exception) {
        console.error(exception)
        this.emit('error', exception)
      }
    })
  })

  return this
}

/**
 * @method moduleReplace
 * @description The more severe cousin of mountApplication which also displays a message on the view
 * indicating that reloading is occurring. This is really only used in the Glass, where code reload
 * events can interfere with what the user is doing and a UI lock of some kind is required.
 */
ActiveComponent.prototype.moduleReplace = function moduleReplace (cb, config) {
  toast('Reloading component')

  this._isReloadingCode = true

  var mount = this.getMount()
  if (mount) {
    mount.style.opacity = '0.2'
  }

  // Stop the clock so we don't continue any animations while this update is happening
  this._componentInstance._context.clock.stop()

  setTimeout(() => {
    return this.reloadComponent((err, updatedHaikuComponentFactory) => {
      if (err) return this.emit('error', err)

      var previousComponentInstance = this._componentInstance

      // We need to re-bootstrap the reloaded component inside the mount so the updated one displays.
      this._componentInstance = updatedHaikuComponentFactory(mount, lodash.assign({}, {
        options: {
          // Don't show the right-click context menu since our editing tools make use of right-click
          contextMenu: 'disabled',
          overflowX: 'visible',
          overflowY: 'visible',
          // Don't track events in mixpanel while the component is being built
          mixpanel: false,
          interactionMode: this._interactionMode
        }
      }, config))

      // Make sure we get notified of state updates and everything else we care about
      this._componentInstance._doesEmitEventsVerbosely = true

      // Need to notify others any time we change our state so that it can be updated dynamically
      this._componentInstance.on('state:set', function _stateSetCb (stateName, stateValue) {
        this.websocket.send({ type: 'broadcast', name: 'state:set', params: [this.folder, stateName, stateValue] })
      }.bind(this))

      // These are used at Haiku Desktop runtime for live editing, e.g. if you change a value we need to compute
      // the previous for interpolation, but since that might be dynamic, we need the full instance
      this.fetchActiveBytecodeFile().set('hostInstance', this._componentInstance)
      this.fetchActiveBytecodeFile().set('states', this._componentInstance._states)

      var existingComponent = previousComponentInstance
      var existingTimelines = existingComponent._timelineInstances

      var incomingComponent = this._componentInstance
      var incomingTimelines = incomingComponent._timelineInstances

      // We need to copy the in-memory timeline (NOT the data object!) over the new one so we retain
      // the same local time/time control data that had already been set by the user
      for (var timelineName in existingTimelines) {
        incomingTimelines[timelineName] = existingTimelines[timelineName]
      }

      // Start the clock again, as we should now be ready to flow updated component.
      this._componentInstance._context.clock.start()

      var incomingBytecode = incomingComponent._bytecode
      var incomingTemplate = incomingComponent._template

      existingComponent._bytecode = incomingBytecode
      existingComponent._template = incomingTemplate

      // Update the entire bytecode object pointer otherwise some updates might not touch the right properties.
      // This also clears all the caches.
      this.rehydrateBytecode(incomingBytecode, incomingTemplate)

      // Give the on-stage renderer time to reflow its changes out to the DOM
      setTimeout(() => {
        // Do this down here *after the flush* so the tree has a chance to repopulate with 'computed' info.
        this._hydrateElements()

        if (mount) {
          mount.style.opacity = '1.0'
        }

        this._isReloadingCode = false

        cb()
      }, 64)
    })
  }, 64)

  return this
}

ActiveComponent.prototype.rehydrateBytecode = function rehydrateBytecode (incomingBytecode, incomingTemplate) {
  // The HaikuComponent *clones* the .template so the template object pointer doesn't get clobbered by
  // other instances. So File updates work, we sort of reattach it here.
  incomingBytecode.template = incomingTemplate

  // In case properties were totally removed as a part of this update, we need to do a full re-render
  // so we clear off everything stale and fully replace with the new version
  this._clearCaches()

  this.fetchActiveBytecodeFile().get('substructs')[0] = {
    objectExpression: null, // Normally a pointer to an AST node, not needed in this context
    bytecode: incomingBytecode
  }

  // Important: Unlesss we do this, the file will be pointing to the old bytecode object when edits are made.
  this.fetchActiveBytecodeFile().set('substructInitialized', this.fetchActiveBytecodeFile().reinitializeSubstruct(null, 'ActiveComponent.prototype.rehydrateBytecode'))

  return this
}

ActiveComponent.prototype.getReifiedBytecode = function getReifiedBytecode () {
  return this.fetchActiveBytecodeFile().getReifiedBytecode()
}

ActiveComponent.prototype.getSerializedBytecode = function getSerializedBytecode () {
  return this.fetchActiveBytecodeFile().getSerializedBytecode()
}

ActiveComponent.prototype.batchPropertyGroupUpdate = function batchPropertyGroupUpdate (componentId, timelineName, timelineTime, propertyKeys) {
  const batchKey = `${componentId}-${timelineName}-${timelineTime}`
  const groupValue = this.getPropertyGroupValue(componentId, timelineName, timelineTime, propertyKeys)
  if (!this._propertyGroupBatches[batchKey]) this._propertyGroupBatches[batchKey] = { componentId, timelineName, timelineTime, groupValue }
  else lodash.assign(this._propertyGroupBatches[batchKey].groupValue, groupValue)
  this.debouncedSendPropertyGroupUpdates()
  this._clearCachedClusters(timelineName, componentId)
}

ActiveComponent.prototype.debouncedSendPropertyGroupUpdates = lodash.debounce(function () {
  const groupBatches = this._propertyGroupBatches
  this._propertyGroupBatches = {} // Unset cache
  lodash.each(groupBatches, ({ componentId, timelineName, timelineTime, groupValue }) => {
    // Call the method in plumbing to update MasterProcess.
    this.websocket.send({ type: 'action', method: 'applyPropertyGroupValue', params: [this.folder, [componentId], timelineName, timelineTime, groupValue] })
  })
}, 100, { trailing: true })

ActiveComponent.prototype.getCurrentTimeline = function getCurrentTimeline () {
  return this._timelines.upsert({
    folder: this.folder,
    name: this._currentTimelineName
  })
}

module.exports = ActiveComponent
