const colorEnabled = !process.env.NO_COLOR

const paint = (code, text) => colorEnabled ? `\u001B[${code}m${text}\u001B[0m` : text

export const symbols = {
  passed: paint('32', '✔'),
  failed: paint('31', '✖'),
  skipped: paint('33', '○'),
  suite: paint('36', '▶')
}

export function printSuite(name) {
  process.stdout.write(`\n${symbols.suite} ${name}\n`)
}

export function printPassed(name, detail = '') {
  process.stdout.write(`  ${symbols.passed} ${name}${detail ? ` ${paint('2', detail)}` : ''}\n`)
}

export function printFailed(name) {
  process.stdout.write(`  ${symbols.failed} ${name}\n`)
}

export function printSkipped(name) {
  process.stdout.write(`  ${symbols.skipped} ${name}\n`)
}
