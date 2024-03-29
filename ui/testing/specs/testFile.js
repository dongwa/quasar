import fse from 'fs-extra'
import { Parser } from 'acorn'
// import { inspect } from 'node:util'

import { pascalCase } from './specs.utils.js'
import { getGenerator } from './generators/map.js'

const ignoreCommentLineMaxLen = 100
const ignoreCommentRE = /^(\/\*.*\n\s*\*\s*Ignored specs:\s*\n.+\n\s*\*\/\s*\n?\n?)/s
const ignoreCommentEntryRE = /(\[[^\]]+\])/g

function getIgnoreCommentIds (ignoreComment) {
  if (ignoreComment === void 0) return []

  const matches = ignoreComment.match(ignoreCommentEntryRE)
  return matches === null
    ? []
    : Array.from(new Set(matches))
}

function createIgnoreComment (ignoreCommentIds) {
  let acc = ''
  let index = 0

  while (index < ignoreCommentIds.length) {
    let line = ' *'
    while (line.length <= ignoreCommentLineMaxLen && index < ignoreCommentIds.length) {
      line += ` ${ ignoreCommentIds[ index ] }`
      index++
    }
    acc += `${ line }\n`
  }

  return `/**\n * Ignored specs:\n${ acc } */\n\n`
}

const treeNodeTypes = [ 'describe', 'test' ]
const treeNodeCalleeTypes = [ 'Identifier', 'MemberExpression', 'CallExpression' ]

function extractTree (astNode, tree, indent) {
  if (
    astNode.type !== 'ExpressionStatement'
    || astNode.expression.type !== 'CallExpression'
    || treeNodeCalleeTypes.includes(astNode.expression.callee.type) === false
  ) return true

  const { callee, arguments: [ id, fn ] } = astNode.expression
  const type = (
    callee.callee?.object?.name // CallExpression
    || callee.object?.name // MemberExpression
    || callee.name // Identifier
  )

  if (treeNodeTypes.includes(type) === false) return

  const entry = {
    insertIndex: fn.body.end - indent,
    type,
    modifier: callee.property?.name || null
  }

  const subTree = {}
  const subIndent = indent + 2
  fn.body.body.forEach(child => {
    extractTree(child, subTree, subIndent)
  })

  entry.children = Object.keys(subTree).length !== 0
    ? subTree
    : null

  tree[ id.value ] = entry
}

function getTestTree (testFileContent) {
  const { body } = Parser.parse(testFileContent, {
    ecmaVersion: 'latest',
    sourceType: 'module'
  })

  const tree = {}
  body.forEach(astNode => extractTree(astNode, tree, 1))

  // console.log(
  //   inspect(tree, {
  //     showHidden: true,
  //     depth: null,
  //     colors: true,
  //     compact: false
  //   })
  // )
  // process.exit(0)
  return tree
}

function getTestFileMisconfiguration ({ ctx, generator, testFile }) {
  const errors = []
  const warnings = []

  const { testTreeRootId } = ctx
  const { testTree, ignoreCommentIds, content } = testFile

  if (content === null) return { errors, warnings }

  if (Object.keys(testTree).length !== 1) {
    errors.push(
      'Should only have one (and only one) root describe(),'
      + ` which should be: describe('${ testTreeRootId }')`
    )

    // early exit... this is fatal
    return { errors, warnings }
  }

  if (Object.keys(testTree)[ 0 ] !== testTreeRootId) {
    errors.push(
      `Should contain a root describe('${ testTreeRootId }')`
    )

    // early exit... this is fatal
    return { errors, warnings }
  }

  const tree = testTree[ testTreeRootId ]

  if (tree.type !== 'describe') {
    errors.push(
      `Found a root ${ tree.type }('${ testTreeRootId }') but it should be a describe()`
    )
  }

  const targetImport = `from './${ ctx.localName }'`
  if (content.indexOf(targetImport) === -1) {
    errors.push(
      `Should contain: import ${ ctx.pascalName } ${ targetImport }`
    )
  }

  const { identifiers } = generator
  const categoryList = Object.keys(identifiers)
    .map(key => identifiers[ key ].categoryId)

  const categoryTestIdMap = Object.keys(identifiers).reduce(
    (acc, key) => {
      const entry = identifiers[ key ]
      if (entry.getTestId !== void 0) {
        acc[ entry.categoryId ] = true
      }
      return acc
    },
    {}
  )

  if (tree.children === null) {
    errors.push(
      `Found empty describe('${ testTreeRootId }'). Delete it.`
    )
    return { errors, warnings }
  }

  Object.keys(tree.children).forEach(categoryId => {
    const { type } = tree.children[ categoryId ]

    if (categoryId[ 0 ] === '[' && categoryList.includes(categoryId) === false) {
      errors.push(
        `Invalid type('${ categoryId }')`
      )
      return
    }

    if (type !== 'describe') {
      errors.push(
        `Found a ${ type }('${ categoryId }') but it should be a describe()`
      )
      return
    }

    const categoryTree = tree.children[ categoryId ].children
    if (categoryTree === null) {
      errors.push(
        `Found empty describe('${ categoryId }'). Delete it.`
      )
      return
    }

    if (categoryTestIdMap[ categoryId ] === void 0) return

    Object.keys(categoryTree).forEach(testId => {
      const { type } = categoryTree[ testId ]

      if (type !== 'describe') {
        errors.push(
          `Found a ${ type }('${ testId }') but it should be a describe()`
        )
        return
      }

      if (ignoreCommentIds.includes(testId) === true) {
        errors.push(
          `Found describe('${ testId }') but it's marked as ignored. Delete the ignore comment.`
        )
        return
      }

      if (categoryTree[ testId ].children === null) {
        errors.push(
          `Found empty describe('${ testId }')`
        )
      }
    })
  })

  return { errors, warnings }
}

function getTestFileMissingTests ({ ctx, generator, testFile }) {
  if (testFile.content === null) return null

  const { identifiers, getJson } = generator

  const json = getJson(ctx)
  if (json === void 0) return null

  const acc = []

  Object.keys(identifiers).forEach(jsonKey => {
    const categoryJson = json[ jsonKey ]
    if (categoryJson === void 0) return

    const { categoryId, getTestId, createTestFn, shouldIgnoreEntry } = identifiers[ jsonKey ]

    if (getTestId === void 0) {
      if (testFile.ignoreCommentIds.includes(categoryId)) return
      if (testFile.testTree[ ctx.testTreeRootId ].children[ categoryId ] !== void 0) return

      acc.push({
        categoryId,
        content: createTestFn({ categoryId, jsonEntry: categoryJson, ctx })
      })
      return
    }

    Object.keys(categoryJson).forEach(entryName => {
      const testId = getTestId(entryName)

      if (testFile.ignoreCommentIds.includes(testId)) return
      if (testFile.testTree[ ctx.testTreeRootId ].children[ categoryId ]?.children[ testId ] !== void 0) return

      const jsonEntry = categoryJson[ entryName ]

      if (jsonEntry.internal === true) return

      const scope = {
        name: entryName,
        pascalName: pascalCase(entryName),
        testId,
        jsonEntry,
        ctx
      }

      if (shouldIgnoreEntry?.(scope) !== true) {
        acc.push({
          testId,
          categoryId,
          content: createTestFn(scope)
        })
      }
    })
  })

  return acc.length !== 0
    ? acc
    : null
}

function generateTestFileSection ({ ctx, generator, jsonPath }) {
  const { identifiers, getJson } = generator

  const json = getJson(ctx)
  if (json === void 0) return null

  const [ jsonKey, entryName ] = jsonPath.split('.')
  if (jsonKey === void 0) return null

  const categoryJson = json[ jsonKey ]
  if (categoryJson === void 0) return null

  const { categoryId, getTestId, createTestFn } = identifiers[ jsonKey ]

  if (getTestId === void 0) {
    return createTestFn({ categoryId, jsonEntry: categoryJson, ctx })
  }

  if (entryName === void 0) return null

  const jsonEntry = categoryJson[ entryName ]
  if (jsonEntry === void 0) return null

  const testId = getTestId(entryName)

  return createTestFn({
    name: entryName,
    pascalName: pascalCase(entryName),
    testId,
    jsonEntry,
    ctx
  })
}

function createTestFileContent ({ ctx, generator }) {
  const { identifiers, getJson, getFileHeader } = generator

  const json = getJson(ctx)
  if (json === void 0) return '/* no associated JSON so we cannot generate anything */'

  let acc = getFileHeader({ ctx, json })
    + `\n\ndescribe('${ ctx.testTreeRootId }', () => {`

  Object.keys(identifiers).forEach(jsonKey => {
    const categoryJson = json[ jsonKey ]
    if (categoryJson === void 0) return

    const { categoryId, getTestId, createTestFn, shouldIgnoreEntry } = identifiers[ jsonKey ]

    if (getTestId === void 0) {
      acc += createTestFn({ categoryId, jsonEntry: categoryJson, ctx })
    }
    else {
      acc += `\n  describe('${ categoryId }', () => {`

      Object.keys(categoryJson).forEach(entryName => {
        const testId = getTestId(entryName)
        const jsonEntry = categoryJson[ entryName ]

        if (jsonEntry.internal === true) return

        const scope = {
          name: entryName,
          pascalName: pascalCase(entryName),
          testId,
          jsonEntry,
          ctx
        }

        if (shouldIgnoreEntry?.(scope) !== true) {
          acc += createTestFn(scope)
        }
      })

      acc += '  })\n'
    }
  })

  return acc + '})\n'
}

function getInitialState (file) {
  const content = fse.readFileSync(file, 'utf-8')
  const match = content.match(ignoreCommentRE)
  const ignoreComment = match?.[ 1 ]

  return {
    content,
    ignoreCommentIds: getIgnoreCommentIds(ignoreComment),
    testTree: getTestTree(content)
  }
}

export function getTestFile (ctx) {
  const file = ctx.testFileAbsolute
  const generator = getGenerator(ctx.targetRelative)
  const generateSection = jsonPath => generateTestFileSection({ ctx, generator, jsonPath })

  if (fse.existsSync(file) === false) {
    return {
      content: null,
      generateSection,
      createContent () {
        return createTestFileContent({ ctx, generator })
      }
    }
  }

  const save = content => {
    testFile.testTree = getTestTree(content)
    fse.writeFileSync(file, content, 'utf-8')
  }

  const testFile = {
    ...getInitialState(file),
    generateSection,

    getMissingTests () {
      return getTestFileMissingTests({ ctx, generator, testFile: this })
    },

    getMisconfiguration () {
      return getTestFileMisconfiguration({ ctx, generator, testFile: this })
    },

    addIgnoreComments (ignoreCommentIds) {
      const hasIgnoreComment = this.ignoreCommentIds.length !== 0
      const newIds = Array.from(
        new Set([
          ...this.ignoreCommentIds,
          ...ignoreCommentIds
        ])
      ).sort()

      const ignoreComment = createIgnoreComment(newIds)

      if (hasIgnoreComment === false) {
        this.content = ignoreComment + this.content
      }
      else {
        this.content = this.content.replace(ignoreCommentRE, ignoreComment)
      }

      this.ignoreCommentIds = newIds
      save(this.content)
    },

    addTestCases (missingTests) {
      const categoryContent = {}

      missingTests.forEach(test => {
        if (categoryContent[ test.categoryId ] !== void 0) {
          categoryContent[ test.categoryId ].content += test.content
          return
        }

        const acc = {
          content: test.content,
          suffix: '',
          prefix: ''
        }

        if (
          test.testId !== void 0
          && this.testTree[ ctx.testTreeRootId ].children[ test.categoryId ] === void 0
        ) {
          acc.prefix = `\n  describe('${ test.categoryId }', () => {`
          acc.suffix = '  })\n'
        }

        categoryContent[ test.categoryId ] = acc
      })

      const categoryList = Object.keys(categoryContent).sort()

      categoryList.forEach(categoryId => {
        const { content, prefix, suffix } = categoryContent[ categoryId ]
        const { insertIndex } = (
          this.testTree[ ctx.testTreeRootId ].children[ categoryId ]
          || this.testTree[ ctx.testTreeRootId ]
        )

        this.content = (
          this.content.slice(0, insertIndex)
          + prefix
          + content
          + suffix
          + this.content.slice(insertIndex)
        )

        // if it crashes, then we didn't inject correctly
        this.testTree = getTestTree(this.content)
      })

      save(this.content)
    }
  }

  return testFile
}
