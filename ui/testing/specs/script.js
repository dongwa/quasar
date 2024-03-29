function showHelp (exitCode = 0) {
  console.log(`
  Description
    UI test files validator & generator

  Usage
    $ specs [-i] [-t <target>]
    $ specs [-t <target>] [-g <json.path>]

    $ specs -i

    $ specs -t QIcon
    $ specs -t components
    $ specs -t Ico
    $ specs -t utils

    $ specs -t QIcon -g props.name

  Options
    --target, -t        Target a component/directive/plugin/composable/other
                           (should not specify file extension)
    --generate, -g      Generates a targeted section of a json path
    --interactive, -i   Interactively validate & create specs
    --help, -h          Show this help message
  `)
  process.exit(exitCode)
}

import parseArgs from 'minimist'

const argv = parseArgs(process.argv.slice(2), {
  alias: {
    t: 'target',
    g: 'generate',
    i: 'interactive',
    h: 'help'
  },
  boolean: [ 'h', 'i' ],
  string: [ 't', 'g' ]
})

if (argv.help) showHelp()

import { getTargetList } from './target.js'
import { ignoredTestFiles } from './ignoredTestFiles.js'
import { createCtx } from './ctx.js'
import { getTestFile } from './testFile.js'

import { cmdValidateTestFile } from './cmd.validateTestFile.js'
import { cmdCreateTestFile } from './cmd.createTestFile.js'
import { cmdGenerateSection } from './cmd.generateSection.js'

const targetList = getTargetList(argv)

if (targetList.length === 0) {
  console.error('No such target found...')
  process.exit(1)
}

for (const target of targetList) {
  if (ignoredTestFiles.has(target) === true) {
    argv.interactive === true && console.log(`  📦 Ignoring "${ target }"`)
    continue
  }

  const ctx = createCtx(target)
  const testFile = getTestFile(ctx)

  if (argv.generate !== void 0) {
    await cmdGenerateSection({ ctx, testFile, jsonPath: argv.generate })
  }
  else if (testFile.content !== null) {
    await cmdValidateTestFile({ ctx, testFile, argv })
  }
  else if (argv.interactive === true) {
    await cmdCreateTestFile({ ctx, testFile, ignoredTestFiles })
  }
}
