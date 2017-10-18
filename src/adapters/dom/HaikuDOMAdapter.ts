/**
 * Copyright (c) Haiku 2016-2017. All rights reserved.
 */

import HaikuContext from './../../HaikuContext';
import HaikuDOMRendererClass from './../../renderers/dom';

const pkg = require('./../../../package.json');
const PLAYER_VERSION = pkg.version;

/**
 * Example ways in which the export of this module is invoked:
 *
 * // via embed snippet
 * window.HaikuPlayer['2.0.125'](require('./code/main/code.js'))
 *
 * // via module require
 * var HaikuDOMAdapter = require('@haiku/player/dom')
 * module.exports = HaikuDOMAdapter(require('./code/main/code.js'))
 */

/**
 * @function HaikuDOMAdapter
 * @description Given a bytecode object, return a factory function which can create a DOM-playable component.
 */
export default function HaikuDOMAdapter(bytecode, config, safeWindow) {
  if (!config) config = {};
  if (!config.options) config.options = {};

  if (!safeWindow) {
    if (typeof window !== 'undefined') {
      safeWindow = window;
    }
  }

  if (config.options.useWebkitPrefix === undefined) {
    // Allow headless mode, e.g. in server-side rendering or in Node.js unit tests
    if (safeWindow && safeWindow.document) {
      const isWebKit =
        'WebkitAppearance' in safeWindow.document.documentElement.style;
      config.options.useWebkitPrefix = !!isWebKit;
    }
  }

  return HaikuContext['createComponentFactory'](
    HaikuDOMRendererClass,
    bytecode,
    config, // Note: Full config object, of which options is one property!
    safeWindow,
  );
}

HaikuDOMAdapter['defineOnWindow'] = function () {
  // Allow multiple players of different versions to exist on the same page
  if (typeof window !== 'undefined') {
    if (!window['HaikuPlayer']) {
      window['HaikuPlayer'] = {};
    }

    window['HaikuPlayer'][PLAYER_VERSION] = HaikuDOMAdapter;
  }
};

HaikuDOMAdapter['defineOnWindow']();
