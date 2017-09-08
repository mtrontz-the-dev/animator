var ReactDOMAdapter = require('@haiku/player/dom/react')
var HaikuDOMComponent = require('./dom')
var ReactDOMComponent = ReactDOMAdapter(HaikuDOMComponent)
if (ReactDOMComponent.default) ReactDOMComponent = ReactDOMComponent.default
ReactDOMComponent.mount = function (element, React, ReactDOM) {
  ReactDOM.render(
    React.createElement(ReactDOMComponent, { options: { loop: true }}),
    element
  )
}
module.exports = ReactDOMComponent
