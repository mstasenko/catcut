import { printFailed, printPassed, printSkipped, printSuite, symbols } from './test-output.mjs'

function topLevelSuite(test) {
  let suite = test.parent
  while (suite.parent?.type === 'suite') suite = suite.parent
  return suite.type === 'suite' ? suite.name : test.module.relativeModuleId
}

function detail(test) {
  const duration = test.diagnostic()?.duration
  return duration === undefined ? '' : `(${Math.round(duration)} ms)`
}

export default class SpacedReporter {
  onTestRunEnd(modules, unhandledErrors) {
    const groups = new Map()
    let passed = 0
    let failed = 0
    let skipped = 0
    for (const module of modules) {
      for (const error of module.errors()) {
        failed += 1
        process.stderr.write(`${error.stack ?? error.message ?? String(error)}\n`)
      }
      for (const test of module.children.allTests()) {
        const name = topLevelSuite(test)
        const tests = groups.get(name) ?? []
        tests.push(test)
        groups.set(name, tests)
      }
    }
    for (const [name, tests] of groups) {
      printSuite(name)
      for (const test of tests) {
        const result = test.result()
        if (result.state === 'passed') {
          passed += 1
          printPassed(test.name, detail(test))
        } else if (result.state === 'skipped') {
          skipped += 1
          printSkipped(test.name)
        } else {
          failed += 1
          printFailed(test.name)
          for (const error of result.errors ?? []) {
            process.stderr.write(`${error.stack ?? error.message ?? String(error)}\n`)
          }
        }
      }
    }

    for (const error of unhandledErrors) {
      failed += 1
      process.stderr.write(`${error.stack ?? error.message ?? String(error)}\n`)
    }
    process.stdout.write(`\n${failed ? symbols.failed : symbols.passed} ${passed} passed${skipped ? `, ${skipped} skipped` : ''}${failed ? `, ${failed} failed` : ''}\n`)
  }
}
