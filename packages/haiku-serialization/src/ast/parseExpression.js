var Parser = require('cst').Parser
var walk = require('estree-walker').walk
var fsm = require('fuzzy-string-matching')
var uniq = require('lodash').uniq
var FORBIDDEN_EXPRESSION_TOKENS = require('@haiku/player/lib/ValueBuilder').default.FORBIDDEN_EXPRESSION_TOKENS

var PARSER = new Parser()
PARSER._options.sourceType = 'script'
PARSER._options.strictMode = false

// Thresholds for fuzzy string matches when detecting any of these types of tokens
var MATCH_WEIGHTS = {
  INJECTABLES: 0.5,
  KEYWORDS: 0.5,
  DECLARATIONS: 0.5
}

function copy (arr) {
  var out = []
  for (var i = 0; i < arr.length; i++) {
    if (Array.isArray(arr[i])) {
      out[i] = copy(arr[i])
    } else {
      out[i] = arr[i]
    }
  }
  return out
}

function wrap (exprWithourWrap) {
  return '(function(){\n' + exprWithourWrap + '\n})'
}

function unwrap (exprWithWrap) {
  return exprWithWrap.slice(13, exprWithWrap.length - 3)
}

function isIdentifierToken (token) {
  return token && token.type === 'Identifier'
}

function isDotToken (token) {
  return token && token.type === 'Punctuator' && token.value === '.'
}

function getSegsList (list, node) {
  if (node.type === 'Identifier') {
    list.push(node)
    return list
  } else if (node.type === 'MemberExpression') {
    getSegsList(list, node.object)
    list.push(node.property)
    return list
  }
}

function buildParamsFromRequestedReferences (references) {
  if (references.length < 1) {
    return []
  }

  var params = []

  // The marshalParams function knows how to take an
  // object like this [a,b,{a:{},b:[c:'c',...]}] and
  // convert it into a parameters string.
  references.forEach((arr) => {
    var basekey = arr[0]

    // If this seg was the first element in the reference array, and if it matches a known
    // forbidden token, then don't include this in the list of injectables
    if (FORBIDDEN_EXPRESSION_TOKENS[basekey]) {
      return null // Skip this reference in its entirety
    }

    params.push(basekey)
  })

  return uniq(params)
}

function isTokenStreamInvalid (tokens, options) {
  if (tokens.length < 1) {
    return {
      annotation: 'Expression is has no content'
    }
  }

  if (tokens.length === 1 && tokens[0].type === 'Keyword' && tokens[0].value === 'return') {
    return {
      annotation: 'Expression is incomplete'
    }
  }

  if (options.skipForbiddensCheck) {
    return false
  }

  var foundReturn = false
  var foundForbiddenToken = false
  var otherWarning = false

  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i]
    var parent = tokens[i - 1]
    var grandparent = tokens[i - 2]

    if (token.type === 'Keyword') {
      if (token.value === 'return') {
        foundReturn = true
      }
    }

    if (token.type === 'Identifier' || token.type === 'Keyword') {
      if (token.value === 'random') {
        if (parent && parent.value === '.') {
          if (grandparent && grandparent.value === 'Math') {
            otherWarning = 'Instead of Math.random(), use $helpers.rand()'
            break
          }
        }
      }

      if (token.value === 'now') {
        if (parent && parent.value === '.') {
          if (grandparent && grandparent.value === 'Date') {
            otherWarning = 'Instead of Date.now(), use $helpers.now()'
            break
          }
        }
      }

      if (FORBIDDEN_EXPRESSION_TOKENS[token.value]) {
        foundForbiddenToken = token
        break
      }
    }
  }

  if (otherWarning) {
    return {
      annotation: otherWarning
    }
  }

  if (foundForbiddenToken) {
    return {
      annotation: foundForbiddenToken.type + ' "' + foundForbiddenToken.value + '" is not allowed in expressions'
    }
  }

  if (!foundReturn) {
    return {
      annotation: 'Expression must have a return statement'
    }
  }

  return false
}

function areParamsImpure (params, keywords, injectables, declarations, options) {
  if (options.skipParamsImpurityCheck) {
    return false
  }

  if (!params) {
    return false
  }

  if (params.length < 1) {
    return false
  }

  // Very naive purity check that just checks the root identifiers that we gathered from params
  // and determines whether we've referred to anything that isn't a known injectible or keyword.
  for (var i = 0; i < params.length; i++) {
    if (!injectables[params[i]] && !keywords[params[i]]) {
      return {
        annotation: `Expression identifier "${params[i]}" is unknown`
      }
    }
  }

  return false
}

function smushKeys (out, base, obj, depth, minDepth, maxDepth) {
  for (var key in obj) {
    var sub = (base) ? (base + '.' + key) : key

    if (depth >= minDepth && depth <= maxDepth) {
      out.push(sub)
    }

    smushKeys(out, sub, obj[key], depth + 1, minDepth, maxDepth)
  }

  return out
}

function populateCompletions (target, injectables, keywords, declarations) {
  var completions = {}

  var segs = getSegsList([], target)

  var chain = segs.map(function _map (identifierNode) {
    return identifierNode.name
  }).join('.')

  // Nothing to do if we have no segments
  if (segs.length < 1) {
    return completions
  }

  // Only try to match declarations and keywords if we are only dealing with one segment
  if (segs.length === 1) {
    for (var declarationKey in declarations) {
      if (fsm(segs[0].name, declarationKey) > MATCH_WEIGHTS.DECLARATIONS) {
        completions[declarationKey] = true
      }
    }

    for (var keywordKey in keywords) {
      if (!FORBIDDEN_EXPRESSION_TOKENS[keywordKey]) {
        if (fsm(segs[0].name, keywordKey) > MATCH_WEIGHTS.KEYWORDS) {
          completions[keywordKey] = true
        }
      }
    }
  }

  var found = {}
  findMatches(found, segs, 0, injectables)

  var smush = smushKeys([], null, found, 0, segs.length - 1, segs.length)
  for (var i = 0; i < smush.length; i++) {
    completions[smush[i]] = true
  }

  // Strip out any exact matches, leaving only remainders
  if (completions[chain]) {
    delete completions[chain]
  }

  // // Strip out any completions that are 'below' the current completion,
  // // but preserve those that are 'above' so we can reveal new possibilities
  // for (var completionString in completions) {
  //   if (completionString.split('.').length < segs.length) {
  //     delete completions[completionString]
  //   }
  // }

  // // If there's only one key here and we have a match, then there's nothing to complete
  // if (Object.keys(completions).length < 2 && completions[chain]) {
  //   return {}
  // }

  return completions
}

function findMatches (found, segs, idx, base) {
  if (Array.isArray(base)) {
    return found
  }
  if (!base || typeof base !== 'object') {
    return found
  }

  var name = segs[idx] && segs[idx].name
  var prev = segs[idx - 1] && segs[idx - 1].name

  if (!name && !prev) {
    return found
  }

  // The user has probably typed a _full_ completion, but we need to check for sub-objects to recommend those
  if (!name && prev) {
    for (var k4 in base) {
      if (!found[k4]) {
        found[k4] = {}
      }
    }

    return found
  }

  if (!name) {
    return found
  }

  // Special case: Just display all injectable roots
  if (name === '$') {
    for (var k1 in base) {
      if (k1[0] === '$') {
        if (!found[k1]) {
          found[k1] = {}
        }
      }
    }

    return found
  }

  // Special case: If under three characters, search on those chars
  if (name.length < 5) {
    var lcname = name.toLowerCase()

    for (var k2 in base) {
      if (k2.slice(0, lcname.length).toLowerCase() === lcname) {
        if (!found[k2]) {
          found[k2] = {}
        }

        findMatches(found[k2], segs, idx + 1, base[k2])
      }
    }

    return found
  }

  for (var k3 in base) {
    if (fsm(name, k3) < MATCH_WEIGHTS.INJECTABLES) {
      continue
    }

    if (!found[k3]) {
      found[k3] = {}
    }

    findMatches(found[k3], segs, idx + 1, base[k3])
  }

  return found
}

function dataizeCompletion (completion) {
  return { name: completion }
}

function chooseTarget (candidate, existing) {
  if (!existing) {
    return candidate
  }

  if (existing.type === 'Identifier' && candidate.type === 'MemberExpression') {
    return candidate
  }

  if (existing.type === 'MemberExpression' && candidate.type === 'Identifier') {
    return existing
  }

  return candidate
}

/**
 * @function parseExpression
 * @description Given an expression string, parse it and return a summary about it, including
 * tokens, params, as well as any warnings/errors that need to be displayed to the coder.
 */
function parseExpression (expr, injectables, keywords, state, cursor, options) {
  if (!options) {
    options = {}
  }

  try {
    // At any point in the process here we may want to populate a warning based on what happens
    var warnings = []

    var cst = PARSER._parseAst(expr)

    var tokens = PARSER._processTokens(cst, expr)
    tokens = tokens.slice(6) // Slice off the "(function(){\n" tokens
    tokens.splice(tokens.length - 4) // Slice off the "})\n\eof" tokens

    let candidates = [] // Going to find possible targets and select the best fit
    // 1. Get a list of all variables that were declared inside the scope of this expression
    // TODO: What other besides var, let, const, and const { a } = {...} is there?
    var declarations = {}
    walk(cst, {
      enter: function enter (node) {
        if (cursor) { // If no cursor, nothing to do
          if (!node.sourceCode && node.loc) { // If no node location, nothing to do; also skip 'Tokens' which have .sourceCode
            if (node.loc.start.line === node.loc.end.line) { // Only identifiers on the same line (not braces)
              if (node.loc.start.line === cursor.line) { // Only on the same line as the cursor
                if (node.loc.start.column <= cursor.ch && node.loc.end.column >= cursor.ch) {
                  if (node.type === 'MemberExpression' || node.type === 'Identifier') {
                    candidates.push(node)
                  }
                }
              }
            }
          }
        }

        if (node.type === 'VariableDeclaration') {
          for (var i = 0; i < node.declarations.length; i++) {
            var declarator = node.declarations[i]
            if (declarator.id.type === 'Identifier') {
              declarations[declarator.id.name] = true
            } else if (declarator.id.type === 'ObjectPattern') {
              for (var j = 0; j < declarator.id.properties.length; j++) {
                declarations[declarator.id.properties[j].key.name] = true
              }
            }
          }
        }
      }
    })

    // The node representing the current placement of the cursor, if any
    let target = null
    // Loop through the candidates and find the one that is the best fit for a target
    for (var i = 0; i < candidates.length; i++) {
      target = chooseTarget(candidates[i], target)
    }

    // 2. Create a list of identifiers that look like references to external things, i.e., anything
    // not defined inside our scope, possibly a keyword or an 'injectable' the user wants to summon.
    var references = []
    if (tokens.length > 2) { // If fewer than 3, really nothing has been typed, so there are no references
      // We're going to build a string that looks like "foo.bar.baz|boo|lala"
      // and then split it on the pipe character to get a list of all of the property access strings
      // and variable identifiers we may want to summon
      var accumulator = ''

      for (var k = 0; k < tokens.length; k++) {
        var curr = tokens[k]
        var prev = tokens[k - 1]
        if (isIdentifierToken(curr)) {
          accumulator += curr.value
        } else if (isDotToken(curr) && isIdentifierToken(prev)) {
          accumulator += curr.value
        } else {
          accumulator += '\n'
        }
      }

      // Now filter out any empty strings, and split each path into parts so we
      // now have an array like [[foo,bar,baz],[boo],[lala]]
      references = accumulator.split('\n').filter((piece) => {
        return (
          piece.length > 0 &&
          !/^\s+$/.test(piece)
        )
      }).map((piece) => {
        return piece.split('.')
      })

      // Now strip away any references that refer to any declarations that were made in scope
      for (var j = references.length - 1; j > -1; j--) {
        var rootref = references[j][0]
        if (declarations[rootref]) {
          references.splice(j, 1)
        }
      }
    }

    var params = buildParamsFromRequestedReferences(copy(references))

    // Completions is initially populated as a dict so we avoid having double entries in the list
    var completions
    // If we got a target node that is an identifier, we can display autocompletions for it, if any match
    if (target && (target.type === 'Identifier' || target.type === 'MemberExpression')) {
      completions = populateCompletions(target, injectables, keywords, declarations)
    } else {
      completions = {}
    }

    completions = Object.keys(completions).map(dataizeCompletion)

    var tokenInvalidity = isTokenStreamInvalid(tokens, options)
    if (tokenInvalidity) {
      warnings.push(tokenInvalidity)
    }

    var paramsImpurity = areParamsImpure(params, keywords, injectables, declarations, options)
    if (paramsImpurity) {
      warnings.push(paramsImpurity)
    }

    return {
      cst: cst,
      tokens: tokens,
      declarations: declarations,
      references: references,
      params: params,
      warnings: warnings,
      completions: completions,
      target: target,
      source: expr
    }
  } catch (error) {
    console.warn('[serialization] Parsing error:', error.message)
    return {
      error: error
    }
  }
}

// Must expose for Timeline <ExpressionInput> component
parseExpression.wrap = wrap
parseExpression.unwrap = unwrap

module.exports = parseExpression
