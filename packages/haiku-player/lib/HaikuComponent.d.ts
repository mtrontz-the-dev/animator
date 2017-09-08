declare let ValueBuilder: any;
declare let vanityHandlers: any;
declare let queryTree: any;
declare let Layout3D: any;
declare let scopifyElements: any;
declare let assign: any;
declare let SimpleEventEmitter: any;
declare let upgradeBytecodeInPlace: any;
declare let addElementToHashTable: any;
declare let HaikuTimeline: any;
declare let Config: any;
declare let PLAYER_VERSION: any;
declare let STRING_TYPE: string;
declare let OBJECT_TYPE: string;
declare let IDENTITY_MATRIX: any;
declare let HAIKU_ID_ATTRIBUTE: string;
declare let DEFAULT_TIMELINE_NAME: string;
declare function HaikuComponent(bytecode: any, context: any, config: any, metadata: any): any;
declare function _cloneTemplate(mana: any): any;
declare function _fetchAndCloneTemplate(template: any): any;
declare function _bindEventHandlers(component: any, extraEventHandlers: any): void;
declare function _bindEventHandler(component: any, eventHandlerDescriptor: any, selector: any, eventName: any, originalHandlerFn: any): void;
declare function _typecheckStateSpec(stateSpec: any, stateSpecName: any): any;
declare function _bindStates(statesTargetObject: any, component: any, extraStates: any): void;
declare function _defineSettableState(component: any, statesHostObject: any, statesTargetObject: any, stateSpec: any, stateSpecName: any): void;
declare function _applyBehaviors(timelinesRunning: any, deltas: any, component: any, template: any, context: any, isPatchOperation: any): void;
declare function _gatherDeltaPatches(component: any, template: any, container: any, context: any, states: any, timelinesRunning: any, eventsFired: any, inputsChanged: any, patchOptions: any): {};
declare function _applyContextChanges(component: any, inputs: any, template: any, container: any, context: any, renderOptions: any): any;
declare function _initializeComponentTree(element: any, component: any, context: any): void;
declare function _expandTreeElement(element: any, component: any, context: any): any;
declare function _shallowCloneComponentTreeElement(element: any): {};
declare let CSS_QUERY_MAPPING: {
    name: string;
    attributes: string;
    children: string;
};
declare function _findMatchingElementsByCssSelector(selector: any, template: any, cache: any): any;
declare function _computeAndApplyTreeLayouts(tree: any, container: any, options: any, context: any): any;
declare function _computeAndApplyNodeLayout(element: any, parent: any, options: any, context: any): void;
declare function _applyPropertyToElement(element: any, name: any, value: any, context: any, component: any): void;
declare function _applyHandlerToElement(match: any, name: any, fn: any, context: any, component: any): any;
declare function _computeAndApplyPresetSizing(element: any, container: any, mode: any, deltas: any): void;
declare function _isBytecode(thing: any): any;
