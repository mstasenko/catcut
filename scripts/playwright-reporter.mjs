import { printFailed, printPassed, printSkipped, printSuite, symbols } from './test-output.mjs'

export default class SpacedReporter {
  groups = new Map()

  onTestEnd(test, result) {
    const path = test.titlePath()
    const parent = path.length > 2 ? path.at(-2) : undefined
    const suite = parent?.endsWith('.spec.ts') ? 'ReplayCat application' : parent ?? 'ReplayCat application'
    const tests = this.groups.get(suite) ?? []
    tests.push({ test, result })
    this.groups.set(suite, tests)
  }

  onEnd() {
    let passed = 0
    let failed = 0
    let skipped = 0
    for (const [suite, tests] of this.groups) {
      printSuite(suite)
      for (const { test, result } of tests) {
        if (result.status === 'passed') {
          passed += 1
          printPassed(test.title, `(${Math.round(result.duration)} ms)`)
        } else if (result.status === 'skipped') {
          skipped += 1
          printSkipped(test.title)
        } else {
          failed += 1
          printFailed(test.title)
          for (const error of result.errors) process.stderr.write(`${error.stack ?? error.message}\n`)
        }
      }
    }
    process.stdout.write(`\n${failed ? symbols.failed : symbols.passed} ${passed} passed${skipped ? `, ${skipped} skipped` : ''}${failed ? `, ${failed} failed` : ''}\n`)
  }
}
