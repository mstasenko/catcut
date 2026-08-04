import { spawn } from 'node:child_process'
import { printFailed, printPassed, printSuite } from './test-output.mjs'

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: options.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    })
    let output = ''
    if (options.quiet) {
      child.stdout.on('data', (chunk) => { output += chunk })
      child.stderr.on('data', (chunk) => { output += chunk })
    }
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(output || `${command} exited with status ${code}`))
    })
  })
}

async function quietCheck(name, command, args) {
  try {
    await run(command, args, { quiet: true })
    printPassed(name)
  } catch (error) {
    printFailed(name)
    process.stderr.write(`${error.message}\n`)
    throw error
  }
}

try {
  printSuite('Static checks')
  await quietCheck('ESLint', 'node_modules/.bin/eslint', ['.'])
  await quietCheck('TypeScript', 'node_modules/.bin/tsc', ['--noEmit'])

  await run('node_modules/.bin/vitest', ['run', '--coverage'])
  await run('node', ['scripts/quality.mjs'])

  printSuite('Application build')
  await quietCheck('Starter media prepared', 'node', ['scripts/build-meme-pack.mjs', '--quiet'])
  await quietCheck('Media licenses and category sizes verified', 'node', ['scripts/verify-meme-pack.mjs'])
  await quietCheck('Electron application compiled', 'node_modules/.bin/electron-vite', ['build', '--logLevel', 'error'])
  await run('node', [
    'scripts/run-headless-wayland.mjs',
    'node_modules/.bin/playwright', 'test'
  ])
} catch {
  process.exitCode = 1
}
