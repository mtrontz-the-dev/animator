import { EventEmitter } from 'events'
import fse from 'haiku-fs-extra'
import path from 'path'
import async from 'async'
import { debounce } from 'lodash'
import walkFiles from 'haiku-serialization/src/utils/walkFiles'
import ActiveComponent from 'haiku-serialization/src/model/ActiveComponent'
import logger from 'haiku-serialization/src/utils/LoggerInstance'
import ProcessBase from './ProcessBase'
import * as Git from './Git'
import ProjectConfiguration from './ProjectConfiguration'
import * as Asset from './Asset'
import Watcher from './Watcher'
import * as Sketch from './Sketch'
import * as ProjectFolder from './ProjectFolder'
import MasterGitProject from './MasterGitProject'
import MasterModuleProject from './MasterModuleProject'

const UNLOGGABLE_METHODS = {
  'masterHeartbeat': true
}

const METHODS_TO_RUN_IMMEDIATELY = {
  'startProject': true,
  'initializeFolder': true,
  'masterHeartbeat': true
}

const FORBIDDEN_METHODS = {
  logMethodMessage: true,
  handleMethodMessage: true,
  callMethodWithMessage: true,
  handleBroadcastMessage: true
}

const METHOD_QUEUE_INTERVAL = 64
const SAVE_AWAIT_TIME = 64 * 2

const WATCHABLE_EXTNAMES = {
  '.js': true,
  '.svg': true,
  '.sketch': true
}

const DESIGN_EXTNAMES = {
  '.sketch': true,
  '.svg': true
}

const UNWATCHABLE_RELPATHS = {
  'index.js': true,
  'haiku.js': true,
  'react-bare.js': true,
  'react.js': true
}

const UNWATCHABLE_BASENAMES = {
  'index.standalone.js': true,
  'index.embed.js': true,
  'dom-embed.js': true,
  'dom-standalone.js': true,
  'react-dom.js': true,
  '~.sketch': true // Ephemeral file generated by sketch during file writes
}

const DEFAULT_BRANCH_NAME = 'master'

function _isFileSignificant (relpath) {
  if (UNWATCHABLE_RELPATHS[relpath]) return false
  if (UNWATCHABLE_BASENAMES[path.basename(relpath)]) return false
  if (!WATCHABLE_EXTNAMES[path.extname(relpath)]) return false
  return true
}

function _excludeIfNotJs (relpath) {
  if (path.extname(relpath) !== '.js') return true
  return !_isFileSignificant(relpath)
}

export default class Master extends EventEmitter {
  constructor (folder) {
    super()

    this.folder = folder

    if (!this.folder) {
      throw new Error('[master] Master cannot launch without a folder defined')
    }

    // IPC hook to communicate with plumbing
    this.proc = new ProcessBase('master') // 'master' is not a branch name in this context

    this.proc.socket.on('close', () => {
      logger.info('[master] !!! socket closed')
      this.teardown()
      this.emit('host-disconnected')
    })

    this.proc.socket.on('error', (err) => {
      logger.info('[master] !!! socket error', err)
    })

    this.proc.on('request', (message, cb) => {
      this.handleMethodMessage(message, cb)
    })

    this.proc.socket.on('broadcast', (message) => {
      this.handleBroadcastMessage(message)
    })

    // Encapsulation of the user's configuration content (haiku.js) (not loaded yet)
    this._config = new ProjectConfiguration()

    // Encapsulation of project actions that relate to git or cloud saving in some way
    this._git = new MasterGitProject(this.folder)

    this._git.on('semver-bumped', (tag, cb) => {
      this.handleSemverTagChange(tag, cb)
    })

    // Encapsulation of project actions that concern the live module in other views
    this._mod = new MasterModuleProject(this.folder, this.proc)

    this._mod.on('triggering-reload', (file) => {
      logger.info('[master] module replacment triggering', file.get('relpath'), file.get('dtLastReadStart'), file.get('dtLastWriteEnd'))
    })

    this._mod.on('reload-complete', (file) => {
      logger.info('[master] module replacment finished', file.get('relpath'))
    })

    // To store a Watcher instance which will watch for changes on the file system
    this._watcher = null

    // Flag denotes whether we've fully initialized and are able to handle websocket methods
    this._isReadyToReceiveMethods = false

    // Queue of accumulated incoming methods we've received that we need to defer until ready
    this._methodQueue = []

    // Worker that handles processing any methods that have accumulated in our queue
    this._methodQueueInterval = setInterval(() => {
      if (this._isReadyToReceiveMethods) {
        const methods = this._methodQueue.splice(0)
        methods.forEach(({ message, cb }) => this.callMethodWithMessage(message, cb))
        clearInterval(this._methodQueueInterval)
      }
    }, METHOD_QUEUE_INTERVAL)

    // Dictionary of all designs in the project, mapping relpath to metadata object
    this._knownDesigns = {}

    // Store an ActiveComponent instance for method delegation
    this._component = null

    // Saving takes a while and we use this flag to avoid overlapping saves
    this._isSaving = false

    // We end up oversaturating the sockets unless we debounce this
    this.debouncedEmitAssetsChanged = debounce(this.emitAssetsChanged.bind(this), 500, { trailing: true })
  }

  teardown () {
    clearInterval(this._methodQueueInterval)
    clearInterval(this._mod._modificationsInterval)
    if (this._git) this._git.teardown()
    if (this._component) this._component._envoyClient.closeConnection()
    if (this._watcher) this._watcher.stop()
  }

  logMethodMessage ({ method, params }) {
    if (!UNLOGGABLE_METHODS[method]) {
      logger.info('[master]', 'calling', method, params)
    }
  }

  handleMethodMessage (message, cb) {
    const { method, params } = message
    // We stop using the queue once we're up and running; no point keeping the queue
    if (METHODS_TO_RUN_IMMEDIATELY[method] || this._isReadyToReceiveMethods) {
      return this.callMethodWithMessage({ method, params }, cb)
    } else {
      return this._methodQueue.push({ message, cb })
    }
  }

  callMethodWithMessage (message, cb) {
    const { method, params } = message
    if (typeof this[method] === 'function' && !FORBIDDEN_METHODS[method]) {
      this.logMethodMessage({ method, params })
      return this[method]({ method, params }, cb)
    } else {
      return cb(new Error(`[master] No such method ${method}`))
    }
  }

  handleBroadcastMessage (message) {
    switch (message.name) {
      case 'component:reload:complete':
        this._mod.handleReloadComplete(message)
        break
    }
  }

  waitForSaveToComplete (cb) {
    if (this._isSaving) {
      return setTimeout(() => {
        return this.waitForSaveToComplete(cb)
      }, SAVE_AWAIT_TIME)
    } else {
      return cb()
    }
  }

  emitAssetsChanged (assets) {
    return this.proc.socket.send({
      type: 'broadcast',
      name: 'assets-changed',
      folder: this.folder,
      assets
    })
  }

  emitDesignChange (relpath) {
    const assets = this.getAssetDirectoryInfo()
    const abspath = path.join(this.folder, relpath)
    const extname = path.extname(relpath)
    logger.info('[master] asset changed', relpath)
    this.emit('design-change', relpath, assets)
    if (this.proc.isOpen()) {
      this.debouncedEmitAssetsChanged(assets)
      if (extname === '.svg') {
        logger.info('[master] merge design requested', relpath)
        this.proc.socket.request({ type: 'action', method: 'mergeDesign', params: [this.folder, 'Default', 0, abspath] }, () => {
          // TODO: Call rest after design merge finishes?
        })
      }
    }
  }

  // /**
  //  * watchers/handlers
  //  * =================
  //  */

  handleFileChange (abspath) {
    const relpath = path.relative(this.folder, abspath)
    const extname = path.extname(relpath)

    if (extname === '.sketch' || extname === '.svg') {
      this._knownDesigns[relpath] = { relpath, abspath, dtModified: Date.now() }
      this.emitDesignChange(relpath)
    }

    return this.waitForSaveToComplete(() => {
      return this._git.commitFileIfChanged(relpath, `Changed ${relpath}`, () => {
        if (!_isFileSignificant(relpath)) {
          return void (0)
        }

        if (extname === '.sketch') {
          logger.info('[master] sketchtool pipeline running; please wait')
          Sketch.sketchtoolPipeline(abspath)
          logger.info('[master] sketchtool done')
          return void (0)
        }

        if (extname === '.js') {
          return this._component.FileModel.ingestOne(this.folder, relpath, (err, file) => {
            if (err) return logger.info(err)
            logger.info('[master] file ingested:', abspath)
            if (relpath === this._component.fetchActiveBytecodeFile().get('relpath')) {
              file.set('substructInitialized', file.reinitializeSubstruct(this._config.get('config'), 'Master.handleFileChange'))
              if (file.get('previous') !== file.get('contents')) {
                this._mod.handleModuleChange(file)
              }
            }
          })
        }
      })
    })
  }

  handleFileAdd (abspath) {
    const relpath = path.relative(this.folder, abspath)
    const extname = path.extname(relpath)

    if (extname === '.sketch' || extname === '.svg') {
      this._knownDesigns[relpath] = { relpath, abspath, dtModified: Date.now() }
      this.emitDesignChange(relpath)
    }

    return this.waitForSaveToComplete(() => {
      return this._git.commitFileIfChanged(relpath, `Added ${relpath}`, () => {
        if (!_isFileSignificant(relpath)) {
          return void (0)
        }

        if (extname === '.sketch') {
          logger.info('[master] sketchtool pipeline running; please wait')
          Sketch.sketchtoolPipeline(abspath)
          logger.info('[master] sketchtool done')
          return void (0)
        }

        if (extname === '.js') {
          return this._component.FileModel.ingestOne(this.folder, relpath, (err, file) => {
            if (err) return logger.info(err)
            logger.info('[master] file ingested:', abspath)
            if (relpath === this._component.fetchActiveBytecodeFile().get('relpath')) {
              file.set('substructInitialized', file.reinitializeSubstruct(this._config.get('config'), 'Master.handleFileAdd'))
            }
          })
        }
      })
    })
  }

  handleFileRemove (abspath) {
    const relpath = path.relative(this.folder, abspath)
    const extname = path.extname(relpath)

    if (extname === '.sketch' || extname === '.svg') {
      delete this._knownDesigns[relpath]
      this.emitDesignChange(relpath)
    }

    return this.waitForSaveToComplete(() => {
      return this._git.commitFileIfChanged(relpath, `Removed ${relpath}`, () => {
        if (!_isFileSignificant(relpath)) {
          return void (0)
        }

        if (extname === '.js') {
          return this._component.FileModel.expelOne(relpath, (err) => {
            if (err) return logger.info(err)
            logger.info('[master] file expelled:', abspath)
          })
        }
      })
    })
  }

  handleSemverTagChange (tag, cb) {
    const file = this._component.fetchActiveBytecodeFile()
    return file.writeMetadata({ version: tag }, (err) => {
      if (err) return cb(err)
      logger.info(`[master-git] bumped bytecode semver to ${tag}`)
      return cb(null, tag)
    })
  }

  // /**
  //  * methods
  //  * =======
  //  */

  masterHeartbeat ({ params }, cb) {
    return cb(null, {
      folder: this.folder,
      isReady: this._isReadyToReceiveMethods,
      isSaving: this._isSaving,
      websocketReadyState: this.proc.getReadyState(),
      isCommitting: this._git.isCommittingProject(),
      gitUndoables: this._git.getGitUndoablesUptoBase(),
      gitRedoables: this._git.getGitRedoablesUptoBase()
    })
  }

  doesProjectHaveUnsavedChanges (message, cb) {
    return Git.status(this.folder, {}, (statusErr, statusesDict) => {
      if (statusErr) return cb(statusErr)
      if (Object.keys(statusesDict).length < 1) return cb(null, false)
      return cb(null, true)
    })
  }

  discardProjectChanges (message, done) {
    return Git.hardReset(this.folder, 'HEAD', (err) => {
      if (err) return done(err)
      return Git.removeUntrackedFiles(this.folder, (err) => {
        if (err) return done(err)
        return done()
      })
    })
  }

  fetchProjectInfo ({ params: [projectName, haikuUsername, haikuPassword, fetchOptions = {}] }, cb) {
    return this._git.fetchFolderState('fetch-info', fetchOptions, (err) => {
      if (err) return cb(err)
      return this._git.getCurrentShareInfo(2000, cb)
    })
  }

  gitUndo ({ params: [undoOptions] }, cb) {
    // Doing an undo while we're saving probably puts us into a bad state
    if (this._isSaving) {
      logger.info('[master] cannot undo while saving')
      return cb()
    }
    logger.info('[master] pushing undo request onto queue')
    return this._git.undo(undoOptions, cb)
  }

  gitRedo ({ params: [redoOptions] }, cb) {
    // Doing an redo while we're saving probably puts us into a bad state
    if (this._isSaving) {
      logger.info('[master] cannot redo while saving')
      return cb()
    }
    logger.info('[master] pushing redo request onto queue')
    return this._git.redo(redoOptions, cb)
  }

  loadAssets (done) {
    return walkFiles(this.folder, (err, entries) => {
      if (err) return done(err)
      entries.forEach((entry) => {
        const extname = path.extname(entry.path)
        if (DESIGN_EXTNAMES[extname]) {
          const relpath = path.normalize(path.relative(this.folder, entry.path))
          this._knownDesigns[relpath] = { relpath, abspath: entry.path, dtModified: Date.now() }
        }
      })
      return this.getAssets(done)
    })
  }

  getAssets (done) {
    return done(null, this.getAssetDirectoryInfo())
  }

  getAssetDirectoryInfo () {
    const info = Asset.assetsToDirectoryStructure(this._knownDesigns)
    const { primaryAssetPath } = ProjectFolder.getProjectNameVariations(this.folder)
    info.forEach((asset) => {
      if (asset.relpath && (path.normalize(asset.relpath) === primaryAssetPath)) {
        asset.isPrimaryDesign = true
      }
    })
    return info
  }

  fetchAssets (message, done) {
    if (Object.keys(this._knownDesigns).length > 0) {
      return this.getAssets(done)
    } else {
      return this.loadAssets(done)
    }
  }

  linkAsset ({ params: [abspath] }, done) {
    const basename = path.basename(abspath)
    const relpath = path.join('designs', basename)
    const destination = path.join(this.folder, relpath)
    return fse.copy(abspath, destination, (copyErr) => {
      if (copyErr) return done(copyErr)
      this._knownDesigns[relpath] = { relpath, abspath: destination, dtModified: Date.now() }
      return done(null, this.getAssetDirectoryInfo())
    })
  }

  unlinkAsset ({ params: [relpath] }, done) {
    if (!relpath || relpath.length < 2) return done(new Error('Relative path too short'))
    const abspath = path.join(this.folder, relpath)
    return fse.remove(abspath, (removeErr) => {
      if (removeErr) return done(removeErr)
      delete this._knownDesigns[relpath]
      return done(null, this.getAssetDirectoryInfo())
    })
  }

  selectElement (message, cb) {
    // this is a no-op in master
    return cb()
  }

  unselectElement (message, cb) {
    // this is a no-op in master
    return cb()
  }

  setTimelineName ({ params }, cb) {
    this._component.setTimelineName.apply(this._component, params)
    return cb()
  }

  setTimelineTime ({ params }, cb) {
    this._component.setTimelineTime.apply(this._component, params)
    return cb()
  }

  readMetadata ({ params }, cb) {
    return this._component.readMetadata.apply(this._component, params.concat(cb))
  }

  readAllStateValues ({ params }, cb) {
    return this._component.readAllStateValues.apply(this._component, params.concat(cb))
  }

  readAllEventHandlers ({ params }, cb) {
    return this._component.readAllEventHandlers.apply(this._component, params.concat(cb))
  }

  setInteractionMode (message, cb) {
    // this is a no-op in master
    return cb()
  }

  previewProject ({ params: [projectName, previewOptions = {}] }, cb) {
    // TODO: Create preview.html and launch in the user's browser
    return cb(new Error('[master] Method not yet implemented'))
  }

  /**
   * bytecode actions
   * ================
   */

  bytecodeAction (action, params, cb) {
    if (!this._component) return cb(new Error('[master] Component not initialized'))
    let file = this._component.fetchActiveBytecodeFile()
    if (!file) return cb(new Error('[master] File not initialized'))
    return file[action].apply(file, params.concat(cb))
  }

  instantiateComponent ({ params }, cb) {
    return this.bytecodeAction('instantiateComponent', params, cb)
  }

  deleteComponent ({ params }, cb) {
    return this.bytecodeAction('deleteComponent', params, cb)
  }

  mergeDesign ({ params }, cb) {
    return this.bytecodeAction('mergeDesign', params, cb)
  }

  applyPropertyValue ({ params }, cb) {
    return this.bytecodeAction('applyPropertyValue', params, cb)
  }

  applyPropertyDelta ({ params }, cb) {
    return this.bytecodeAction('applyPropertyDelta', params, cb)
  }

  applyPropertyGroupValue ({ params }, cb) {
    return this.bytecodeAction('applyPropertyGroupValue', params, cb)
  }

  applyPropertyGroupDelta ({ params }, cb) {
    return this.bytecodeAction('applyPropertyGroupDelta', params, cb)
  }

  resizeContext ({ params }, cb) {
    return this.bytecodeAction('resizeContext', params, cb)
  }

  changeKeyframeValue ({ params }, cb) {
    return this.bytecodeAction('changeKeyframeValue', params, cb)
  }

  changePlaybackSpeed ({ params }, cb) {
    return this.bytecodeAction('changePlaybackSpeed', params, cb)
  }

  changeSegmentCurve ({ params }, cb) {
    return this.bytecodeAction('changeSegmentCurve', params, cb)
  }

  changeSegmentEndpoints ({ params }, cb) {
    return this.bytecodeAction('changeSegmentEndpoints', params, cb)
  }

  createKeyframe ({ params }, cb) {
    return this.bytecodeAction('createKeyframe', params, cb)
  }

  createTimeline ({ params }, cb) {
    return this.bytecodeAction('createTimeline', params, cb)
  }

  deleteKeyframe ({ params }, cb) {
    return this.bytecodeAction('deleteKeyframe', params, cb)
  }

  deleteTimeline ({ params }, cb) {
    return this.bytecodeAction('deleteTimeline', params, cb)
  }

  duplicateTimeline ({ params }, cb) {
    return this.bytecodeAction('duplicateTimeline', params, cb)
  }

  joinKeyframes ({ params }, cb) {
    return this.bytecodeAction('joinKeyframes', params, cb)
  }

  moveSegmentEndpoints ({ params }, cb) {
    return this.bytecodeAction('moveSegmentEndpoints', params, cb)
  }

  moveKeyframes ({ params }, cb) {
    return this.bytecodeAction('moveKeyframes', params, cb)
  }

  renameTimeline ({ params }, cb) {
    return this.bytecodeAction('renameTimeline', params, cb)
  }

  sliceSegment ({ params }, cb) {
    return this.bytecodeAction('sliceSegment', params, cb)
  }

  splitSegment ({ params }, cb) {
    return this.bytecodeAction('splitSegment', params, cb)
  }

  zMoveToFront ({ params }, cb) {
    return this.bytecodeAction('zMoveToFront', params, cb)
  }

  zMoveForward ({ params }, cb) {
    return this.bytecodeAction('zMoveForward', params, cb)
  }

  zMoveBackward ({ params }, cb) {
    return this.bytecodeAction('zMoveBackward', params, cb)
  }

  zMoveToBack ({ params }, cb) {
    return this.bytecodeAction('zMoveToBack', params, cb)
  }

  reorderElement ({ params }, cb) {
    return this.bytecodeAction('reorderElement', params, cb)
  }

  groupElements ({ params }, cb) {
    return this.bytecodeAction('groupElements', params, cb)
  }

  ungroupElements ({ params }, cb) {
    return this.bytecodeAction('ungroupElements', params, cb)
  }

  hideElements ({ params }, cb) {
    return this.bytecodeAction('hideElements', params, cb)
  }

  pasteThing ({ params }, cb) {
    return this.bytecodeAction('pasteThing', params, cb)
  }

  deleteThing ({ params }, cb) {
    return this.bytecodeAction('deleteThing', params, cb)
  }

  upsertStateValue ({ params }, cb) {
    return this.bytecodeAction('upsertStateValue', params, cb)
  }

  deleteStateValue ({ params }, cb) {
    return this.bytecodeAction('deleteStateValue', params, cb)
  }

  upsertEventHandler ({ params }, cb) {
    return this.bytecodeAction('upsertEventHandler', params, cb)
  }

  deleteEventHandler ({ params }, cb) {
    return this.bytecodeAction('deleteEventHandler', params, cb)
  }

  writeMetadata ({ params }, cb) {
    return this.bytecodeAction('writeMetadata', params, cb)
  }

  /**
   * here be dragons
   * ===============
   */

  /**
   * @method initializeFolder
   */
  initializeFolder ({ params: [projectName, haikuUsername, haikuPassword, projectOptions] }, done) {
    // We need to clear off undos in the case that somebody made an fs-based commit between sessions;
    // if we tried to reset to a previous "known" undoable, we'd miss the missing intermediate one.
    // This has to happen in initializeFolder because it's here that we set the 'isBase' undoable.
    this._git.restart({
      projectName,
      haikuUsername,
      haikuPassword,
      branchName: DEFAULT_BRANCH_NAME
    })

    // Note: 'ensureProjectFolder' and/or 'buildProjectContent' should already have ran by this point.
    return async.series([
      (cb) => {
        return this._git.initializeProject(projectOptions, cb)
      },

      // Now that we've (maybe) cloned content, we need to create any other necessary files that _might not_ yet
      // exist in the folder. You may note that we run this method _before_ this process, and ask yourself: why twice?
      // Well, don't be fooled. Both methods are necessary due to the way git pulling is handled: if a project has
      // never had remote content pulled, but has changes, we move those changes away them copy them back in on top of
      // the cloned content. Which means we have to be sparing with what we create on the first run, but also need
      // to create any missing remainders on the second run.
      (cb) => {
        return ProjectFolder.buildProjectContent(null, this.folder, projectName, 'haiku', {
          organizationName: projectOptions.organizationName, // Important: Must set this here or the package.name will be wrong
          skipContentCreation: false,
          skipCDNBundles: true
        }, cb)
      },

      (cb) => {
        return this._git.snapshotCommitProject('Initialized folder', cb)
      },

      // Make sure we are starting with a good git history
      (cb) => {
        return this._git.setUndoBaselineIfHeadCommitExists(cb)
      }
    ], (err, results) => {
      if (err) return done(err)
      return done(null, results[results.length - 1])
    })
  }

  /**
   * @method startProject
   */
  startProject (message, done) {
    logger.info(`[master] start project: ${this.folder}`)

    this._mod.restart()
    this._git.restart()

    const response = {
      projectName: null
    }

    return async.series([
      // Load the user's configuration defined in haiku.js (sort of LEGACY)
      (cb) => {
        logger.info(`[master] start project: loading configuration for ${this.folder}`)
        return this._config.load(this.folder, (err) => {
          if (err) return done(err)
          // Gotta make this available after we load the config, but before anything else, since the
          // done callback happens immediately if we've already initialized this master process once.
          response.projectName = this._config.get('config.name')
          return cb()
        })
      },

      // Initialize the ActiveComponent and file models
      (cb) => {
        // No need to reinitialize if already in memory
        if (!this._component) {
          logger.info(`[master] start project: creating active component`)

          this._component = new ActiveComponent({
            alias: 'master', // Don't be fooled, this is not a branch name
            folder: this.folder,
            userconfig: this._config.get('config'),
            websocket: {/* websocket */},
            platform: {/* window */},
            envoy: ProcessBase.HAIKU.envoy || {
              host: process.env.ENVOY_HOST,
              port: process.env.ENVOY_PORT
            },
            file: {
              doShallowWorkOnly: false, // Must override the in-memory-only defaults
              skipDiffLogging: false // Must override the in-memory-only defaults
            }
          })

          // This is required so that a hostInstance is loaded which is (required for calculations)
          this._component.mountApplication()

          this._component.on('component:mounted', () => {
            // Since we aren't running in the DOM cancel the raf to avoid leaked handles
            this._component._componentInstance._context.clock.GLOBAL_ANIMATION_HARNESS.cancel()
            return cb()
          })
        } else {
          return cb()
        }
      },

      // Take an initial commit of the starting state so we have a baseline
      (cb) => {
        return this._git.snapshotCommitProject('Project setup', cb)
      },

      // Load all relevant files into memory (only JavaScript files for now)
      (cb) => {
        logger.info(`[master] start project: ingesting js files in ${this.folder}`)
        return this._component.FileModel.ingestFromFolder(this.folder, {
          exclude: _excludeIfNotJs
        }, cb)
      },

      // Do any setup necessary on the in-memory bytecode object
      (cb) => {
        const file = this._component.fetchActiveBytecodeFile()
        if (file) {
          logger.info(`[master] start project: initializing bytecode`)
          file.set('substructInitialized', file.reinitializeSubstruct(this._config.get('config'), 'Master.startProject'))
          return file.performComponentWork((bytecode, mana, wrapup) => wrapup(), cb)
        } else {
          return cb()
        }
      },

      // Take an initial commit of the starting state so we have a baseline
      (cb) => {
        return this._git.snapshotCommitProject('Code setup', cb)
      },

      // Start watching the file system for changes
      (cb) => {
        // No need to reinitialize if already in memory
        if (!this._watcher) {
          logger.info('[master] start project: initializing file watcher', this.folder)
          this._watcher = new Watcher()
          this._watcher.watch(this.folder)
          this._watcher.on('change', this.handleFileChange.bind(this))
          this._watcher.on('add', this.handleFileAdd.bind(this))
          this._watcher.on('remove', this.handleFileRemove.bind(this))
          logger.info('[master] start project: file watcher is now watching', this.folder)
          return cb()
        } else {
          return cb()
        }
      },

      // Make sure we are starting with a good git history
      (cb) => {
        return this._git.setUndoBaselineIfHeadCommitExists(cb)
      },

      // Finish up and signal that we are ready
      (cb) => {
        this._isReadyToReceiveMethods = true
        logger.info(`[master] start project: ready`)
        return cb(null, response)
      }
    ], (err, results) => {
      if (err) return done(err)
      return done(null, results[results.length - 1])
    })
  }

  /**
   * @method saveProject
   */
  saveProject ({ params: [projectName, haikuUsername, haikuPassword, saveOptions = {}] }, done) {
    const finish = (err, out) => {
      this._isSaving = false
      return done(err, out)
    }

    if (this._isSaving) {
      logger.info('[master] project save: already in progress! short circuiting')
      return done()
    }

    this._isSaving = true

    logger.info('[master] project save')

    return async.series([
      // Check to see if a save is even necessary, and return early if not
      (cb) => {
        return this._git.getExistingShareDataIfSaveIsUnnecessary((err, existingShareData) => {
          if (err) return cb(err)
          if (existingShareData) { // Presence of share data means early return
            return cb(true, existingShareData) // eslint-disable-line
          }
          return cb() // Falsy share data means perform the save
        })
      },

      // Populate the bytecode's metadata. This may be a no-op if the file has already been saved
      (cb) => {
        logger.info('[master] project save: assigning metadata')

        const {
          semverVersion,
          organizationName,
          projectName,
          branchName
        } = this._git.getFolderState()

        const bytecodeMetadata = {
          uuid: 'HAIKU_SHARE_UUID',
          player: this._git.getHaikuPlayerLibVersion(),
          version: semverVersion,
          organization: organizationName,
          project: projectName,
          branch: branchName
        }

        return this._component.fetchActiveBytecodeFile().writeMetadata(bytecodeMetadata, cb)
      },

      (cb) => {
        return this._git.snapshotCommitProject('Updated metadata', cb)
      },

      // Build the rest of the content of the folder, including any bundles that belong on the cdn
      (cb) => {
        logger.info('[master] project save: populating content')
        const { projectName } = this._git.getFolderState()
        return ProjectFolder.buildProjectContent(null, this.folder, projectName, 'haiku', {
          projectName: projectName,
          haikuUsername: haikuUsername,
          authorName: saveOptions.authorName,
          organizationName: saveOptions.organizationName
        }, cb)
      },

      (cb) => {
        return this._git.snapshotCommitProject('Populated content', cb)
      },

      // Now do all of the git/share/publish/fs operations required for the real save
      (cb) => {
        logger.info('[master] project save: committing, pushing, publishing')
        return this._git.saveProject(saveOptions, cb)
      }
    ], (err, results) => { // async gives back _all_ results from each step
      if (err && err !== true) return finish(err)
      return finish(null, results[results.length - 1])
    })
  }
}
