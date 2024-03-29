export const testIndent = '        '
const pascalRegex = /((-|\.)\w)/g
const kebabRegex = /[A-Z\u00C0-\u00D6\u00D8-\u00DE]/g

export function pascalCase (str) {
  return str.replace(
    pascalRegex,
    text => text.replace(/-|\./, '').toUpperCase()
  )
}

export function kebabCase (str) {
  return str.replace(
    kebabRegex,
    match => '-' + match.toLowerCase()
  ).substring(1)
}

export function plural (num) {
  return num === 1 ? '' : 's'
}

const defTypeMap = {
  Number: {
    valueRegex: /^-?\d/,
    createValue: () => () => '10',
    expectType: () => ref => `expect(${ ref }).toBeTypeOf('number')`
  },

  String: {
    valueRegex: /^'[^']+'$/,
    createValue: () => () => '\'some-string\'',
    expectType: () => ref => `expect(${ ref }).toBeTypeOf('string')`
  },

  Array: {
    valueRegex: /^\[.*\]$/,
    createValue: def => {
      if (def.definition === void 0) return () => '[]'

      return (indentation = testIndent) => {
        const keyIndent = indentation + '  '
        const list = Object.keys(def.definition).map(key => {
          const { createValue } = getDefTesting(def.definition[ key ])
          return `\n${ keyIndent }${ key }: ${ createValue(keyIndent) }`
        })

        return `[{${ list.join(',') }\n${ indentation }}]`
      }
    },
    expectType: def => (
      def.definition === void 0
        ? ref => `expect(Array.isArray(${ ref })).toBe(true)`
        : ref => `expect(${ ref }).toContainEqual(${ getObjectEqualDef(def.definition, '') })`
    )
  },

  Object: {
    valueRegex: /^{.*}$/,
    createValue: def => {
      if (def.definition === void 0) return () => '{}'

      return (indentation = testIndent) => {
        const keyIndent = indentation + '  '
        const list = Object.keys(def.definition).map(key => {
          const { createValue } = getDefTesting(def.definition[ key ])
          return `\n${ keyIndent }${ key }: ${ createValue(keyIndent) }`
        })

        return `{${ list.join(',') }\n${ indentation }}`
      }
    },
    expectType: def => (
      def.definition === void 0
        ? ref => `expect(${ ref }).toBeTypeOf('object')`
        : ref => `expect(${ ref }).toEqual(${ getObjectEqualDef(def.definition, '') })`
    )
  },

  Boolean: {
    valueRegex: /^(true|false)$/,
    createValue: () => () => 'true',
    expectType: () => ref => `expect(${ ref }).toBeTypeOf('boolean')`
  },

  Function: {
    valueRegex: / => /, // example: "(file) => file.name"
    createValue: def => getFunctionValue(def),
    expectType: def => (ref, opts = {}) => (
      `expect(${ ref }).toBeTypeOf('function')`
      + (
        opts.withCall === true
          ? getFunctionCallTest(def, ref)
          : ''
      )
    )
  },

  RegExp: {
    valueRegex: /^\/.*\/[gimuy]*$/,
    createValue: () => () => '/.*/',
    expectType: () => ref => `expect(${ ref }).toBeInstanceOf(RegExp)`
  },

  Element: {
    valueRegex: /(^document\.?|^\..+|^#.+|^body\.?|.+El$|\$refs)/,
    createValue: () => () => 'document.createElement(\'div\')',
    expectType: () => ref => `expect(${ ref }).toBeInstanceOf(Element)`
  },

  Any: {
    createValue: () => () => '\'any-value\'',
    expectType: () => ref => `expect(${ ref }).not.toBeUndefined()`
  },

  Event: {
    createValue: () => () => '{}',
    expectType: () => ref => `expect(${ ref }).toBeTypeOf('object')`
  },

  File: {
    createValue: () => () => 'new File([], \'file.txt\')',
    expectType: () => ref => `expect(${ ref }).toBeInstanceOf(File)`
  },

  null: {
    valueRegex: /^null$/,
    createValue: () => () => 'null',
    expectType: () => ref => `expect(${ ref }).toBeNull()`
  },

  undefined: {
    valueRegex: /^undefined$/,
    createValue: () => () => 'undefined',
    expectType: () => ref => `expect(${ ref }).toBeUndefined()`
  }
}

const defTypeTestableValueKeyList = Object.keys(defTypeMap)
  .filter(key => defTypeMap[ key ].valueRegex !== void 0)

function getFunctionValue (def) {
  return (indentation = testIndent) => {
    const callParams = Object.keys(def.params || [])
      .map(paramName => `_${ paramName }`)
      .join(', ')

    if (def.returns !== void 0) {
      const { createValue } = getDefTesting(def.returns)
      return `(${ callParams }) => ${ createValue(indentation) }`
    }

    return `(${ callParams }) => {}`
  }
}

function getFunctionCallTest (def, ref) {
  const paramIndent = testIndent + '  '
  let callParams = Object.keys(def.params || [])
    .map(paramName => {
      const { createValue } = getDefTesting(def.params[ paramName ])
      return `\n${ paramIndent }${ createValue(paramIndent) }`
    })
    .join(',')

  if (callParams.length !== 0) {
    callParams += `\n${ testIndent }`
  }

  if (def.returns !== void 0) {
    const { expectType } = getDefTesting(def.returns)
    return `\n${ testIndent }${ expectType(`${ ref }(${ callParams })`) }`
  }

  return `\n${ testIndent }expect(${ ref }(${ callParams })).toBeUndefined()`
}

const objectEqualDefTypeExceptions = [ 'Any', 'Component' ]

function getObjectEqualDef (definition, localIndent) {
  const list = Object.keys(definition).map(key => {
    const target = definition[ key ]
    let type = Array.isArray(target.type)
      ? target.type[ 0 ]
      : target.type

    if (type.startsWith('Promise') === true) {
      type = 'Promise'
    }

    const valueTest = objectEqualDefTypeExceptions.includes(type)
      ? 'expect.anything()'
      : (
          type === 'Object' && (target.definition !== void 0 || target.scope !== void 0)
            ? `expect.objectContaining(${ getObjectEqualDef(target.definition || target.scope, localIndent + '  ') })`
            : `expect.any(${ type })`
        )

    return `\n${ testIndent }${ localIndent }  ${ key }: ${ valueTest }`
  })

  return `{${ list.join(',') }\n${ testIndent }${ localIndent }}`
}

const defTypeExceptionList = [
  'FileList',
  'Promise<any>',
  'Promise<void>',
  'Promise<boolean>',
  'Promise<number>',
  'Promise<string>',
  'Promise<object>'
]

export function filterDefExceptionTypes (type) {
  if (Array.isArray(type) === true) {
    const list = type.filter(type => defTypeExceptionList.includes(type) === false)
    return list.length === 1
      ? list[ 0 ]
      : list
  }

  if (defTypeExceptionList.includes(type) === false) {
    return type
  }
}

export function getDefTesting (def) {
  const { type, default: defaultVal, values, examples } = def

  const valuesList = [
    ...(defaultVal !== void 0 ? [ defaultVal ] : []),
    ...(values || []),
    ...(examples || [])
    // filter example: "# hard-coded palette", "# right/left"
  ].filter(v => /^# $/.test(v) === false)

  const typeList = Array.isArray(type) === false
    ? [ type ]
    : type

  for (const typeBeingTested of typeList) {
    if (typeBeingTested === 'Any') {
      for (const typeWithRegex of defTypeTestableValueKeyList) {
        const { valueRegex, expectType } = defTypeMap[ typeWithRegex ]
        for (const val of valuesList) {
          if (valueRegex.test(val) === true) {
            return {
              type: typeWithRegex,
              createValue: () => val,
              expectType: expectType(def)
            }
          }
        }
      }

      break
    }

    const target = defTypeMap[ typeBeingTested ]
    if (target?.valueRegex === void 0) continue
    const { valueRegex, expectType } = target

    for (const val of valuesList) {
      if (valueRegex.test(val) === true) {
        return {
          type: typeBeingTested,
          createValue: () => val,
          expectType: expectType(def)
        }
      }
    }
  }

  for (const fallbackType of typeList) {
    if (defTypeExceptionList.includes(fallbackType) === true) continue
    const fallback = defTypeMap[ fallbackType ]

    if (fallback === void 0) {
      console.error('\ndef:', def)
      console.error('specs.utils: getDefTesting() -> Unknown type:', fallbackType)
      console.trace()
      process.exit(1)
    }

    return {
      type: fallbackType,
      createValue: fallback.createValue(def),
      expectType: fallback.expectType(def)
    }
  }

  console.error('\ndef:', def)
  console.error('specs.utils: getDefTesting() -> Cannot handle any of type(s):', typeList)
  console.trace()
  process.exit(1)
}

function getMountRequiredProps (jsonProps, exceptionProp) {
  const acc = []
  const propIndent = `${ testIndent }    `

  Object.keys(jsonProps || []).forEach(prop => {
    if (prop === exceptionProp) return

    const propDef = jsonProps[ prop ]

    if (propDef.required) {
      const pascalName = pascalCase(prop)
      const { createValue } = getDefTesting(propDef)

      acc.push([ pascalName, createValue(propIndent) ])

      if (propDef.sync === true) {
        acc.push([ `'onUpdate:${ pascalName }'`, '(_val) => {}' ])
      }
    }
  })

  return acc
}

function getMountSlot ({ name, slotFn }) {
  const nameAsObjKey = name.indexOf('-') === -1
    ? name
    : `'${ name }'` // example: 'navigation-icon'

  return `\n${ testIndent }  slots: {`
    + `\n${ testIndent }    ${ nameAsObjKey }: ${ slotFn }`
    + `\n${ testIndent }  }`
}

export function getComponentMount ({ ctx, prop = null, slot = null }) {
  const { json } = ctx
  const requiredProps = getMountRequiredProps(json.props, prop)

  if (prop !== null) {
    const pascalName = pascalCase(prop)
    requiredProps.push([ pascalName, 'propVal' ])
    if (json.props[ prop ].sync === true) {
      requiredProps.push([ `'onUpdate:${ pascalName }'`, 'val => { propVal = val }' ])
    }
  }

  const propList = requiredProps.map(([ prop, testVal ]) => {
    return `${ testIndent }    ${ prop }: ${ testVal }`
  })

  const slotList = slot !== null
    ? getMountSlot(slot)
    : ''

  if (propList.length === 0 && slotList === '') {
    return `const wrapper = mount(${ ctx.pascalName })`
  }

  return `const wrapper = mount(${ ctx.pascalName }, {`
    + (
      propList.length !== 0
        ? (
            `\n${ testIndent }  props: {\n`
            + propList.join(',\n')
            + `\n${ testIndent }  }`
          )
        : ''
    )
    + (propList.length !== 0 && slotList !== '' ? ',' : '')
    + slotList
    + `\n${ testIndent }})`
}
