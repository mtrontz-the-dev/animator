const { URL } = require('url')
const tape = require('tape')
const Figma = require('./../../src/bll/Figma')
const SampleFileFixture = require('../fixtures/figma/sample-file.json')
const SampleImageResponseFixture = require('../fixtures/figma/images.json')

const token = 'Rs1Ajdgb4hgmWbKcsahi2U2xtRevBqG-kipftTeZ'
const fileKey = 'DwxTPCNWQZJyU3X44CH3DQpT'

tape('Figma.parseProjectURL parses an URL and returns an object with the id and the name of a Figma project', (t) => {
  t.plan(3)

  const parsedURL = Figma.parseProjectURL(`https://www.figma.com/file/${fileKey}/Sample-File`)

  t.equal(typeof parsedURL, 'object', 'the parsed URL is an object')
  t.equal(parsedURL.name, 'Sample-File', 'the parsed URL contains the file name under the "name" key')
  t.equal(parsedURL.id, fileKey, 'the parsed URL contains the id of the file')
})

tape('Figma.parseProjectURL returns null if the URL can\'t be parsed properly', (t) => {
  t.plan(2)

  t.notOk(Figma.parseProjectURL('https://www.figma.com/'))
  t.notOk(Figma.parseProjectURL('asdfasd'))
})

tape('Figma.request makes a proper request', (t) => {
  t.plan(2)

  const figma = new Figma({token, requestLib: function({uri, headers}) {
    t.ok(headers.Authorization.includes(token), 'headers includes the correct token')
    t.ok(uri.includes(fileKey), 'URI is correct')
  }})

  figma.request({uri: fileKey})
})

tape('Figma.request allows a param to disable authentication', (t) => {
  t.plan(1)

  const figma = new Figma({token, requestLib: function({uri, headers}) {
    t.notOk(headers.Authorization, 'headers do not include a token')
  }})

  figma.request({uri: fileKey, auth: false})
})

tape('Figma.findInstantiableElements', (t) => {
  t.plan(6)

  const sliceKey = '5:0'
  const groupKey = '8:0'
  const figma = new Figma({token})
  const elements = figma.findInstantiableElements(JSON.stringify(SampleFileFixture))

  t.ok(Array.isArray(elements), 'returns an array of elements')
  t.equal(elements.length, 3, 'returns an array that includes all elements required to be finded')
  t.equal(elements[0].id, groupKey, 'includes elements of type GROUP')
  t.equal(elements[1].id, sliceKey, 'includes elements of type SLICE')
  t.equal(elements[1].name, 'Slice', 'passes through first unique instances of element names')
  t.equal(elements[2].name, 'Slice Copy 1', 'renames duplicately named slices to allow async fetch/write')
})

tape('Figma.getSVGLinks', async (t) => {
  t.plan(3)

  try {
    const figma = new Figma({token, requestLib: ({uri}, callback) => {
      callback(null, {statusCode: 200}, JSON.stringify(SampleImageResponseFixture))
    }})

    const elements = figma.findInstantiableElements(JSON.stringify(SampleFileFixture))
    const links = await figma.getSVGLinks(elements, fileKey)
    t.ok(Array.isArray(links), 'returns an array of elements')
    t.equal(links.length, elements.length, 'adds links to all elements')
    t.equal(links[0].svgURL, SampleImageResponseFixture.images[elements[0].id], 'adds the correct link to elements')
  } catch (e) {
    t.error(e)
  }
})

tape('Figma.buildAuthenticationLink', (t) => {
  t.plan(3)

  const {url, state} = Figma.buildAuthenticationLink(fileKey)
  const parsedURL = new URL(url)
  const redirectURI = new URL(parsedURL.searchParams.get('redirect_uri'))

  t.equal(parsedURL.pathname, `/oauth`, 'points to the /oauth path in Figma')
  t.equal(redirectURI.protocol, 'haiku:', 'redirect_uri uses the haiku:// protocol')
  t.ok(url.includes(state), 'url includes the returned state')
})

tape('Figma.buildFigmaLink', (t) => {
  t.plan(1)

  const url = Figma.buildFigmaLink(fileKey)

  t.ok(url.includes(`/files/${fileKey}`), 'builds a link to the figma file')
})

tape('Figma.isFigmaFile', (t) => {
  t.plan(2)

  const figmaPath = `/designs/${fileKey}-something.figma`
  const otherPath = '/something/else.sketch'

  t.ok(Figma.isFigmaFile(figmaPath), 'returns true if the path basename ends with .figma')
  t.notOk(Figma.isFigmaFile(otherPath), 'returns false if the path basename does not ends with .figma')
})

tape('Figma.isFigmaFolder', (t) => {
  t.plan(2)

  const figmaPath = `/designs/${fileKey}-something.figma.contents/`
  const otherPath = '/something/else.sketch.contents/'

  t.ok(Figma.isFigmaFolder(figmaPath), 'returns true if the path is a figma folder')
  t.notOk(Figma.isFigmaFolder(otherPath), 'returns false if the path is not a figma folder')
})

tape('Figma.findIDFromPath', (t) => {
  t.plan(2)

  const figmaPath = `/designs/${fileKey}-something.figma.contents/`
  const otherPath = '/something/else.sketch.contents/'

  t.equal(Figma.findIDFromPath(figmaPath), fileKey, 'returns the correct ID if an ID can be found')
  t.notOk(Figma.findIDFromPath(otherPath), 'returns a falsey value if it cannot find an ID')
})
