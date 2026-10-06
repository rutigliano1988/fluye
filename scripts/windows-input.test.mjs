import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { mock, test } from 'node:test'
import { WindowsInput, inputErrorMessage } from '../src/main/windows-input.ts'

function fakeWorker() {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.requests = []
  child.stdin = new Writable({ write(chunk, _encoding, callback) {
    child.requests.push(JSON.parse(chunk.toString()))
    callback()
  } })
  child.kill = () => { child.emit('exit', 1); return true }
  return child
}

async function fixture(run) {
  const child = fakeWorker()
  let spawns = 0
  const replacement = mock.method(childProcess, 'spawn', (_exe, args, options) => {
    spawns++
    assert.equal(options.windowsHide, true)
    assert.ok(args.includes('-EncodedCommand'))
    return child
  })
  syncBuiltinESMExports()
  const input = new WindowsInput()
  try { await run(input, child, () => spawns) }
  finally { input.stop(); replacement.mock.restore(); syncBuiltinESMExports() }
}

test('one warm worker handles repeated requests and split response lines', () => fixture(async (input, child, spawns) => {
  const ready = input.start()
  child.stdout.write('REA')
  child.stdout.write('DY\n')
  await ready
  const capture = input.capture('123')
  await Promise.resolve()
  const request = child.requests.at(-1)
  assert.equal(request.handle, '123')
  const reply = JSON.stringify({ id: request.id, value: 'editor-token' })
  child.stdout.write(reply.slice(0, 9))
  child.stdout.write(reply.slice(9) + '\n')
  assert.equal(await capture, 'editor-token')
  const send = input.send('editor-token', 0x56)
  await Promise.resolve()
  const paste = child.requests.at(-1)
  assert.equal(paste.token, 'editor-token')
  assert.deepEqual(paste.release, [0x10, 0x11, 0x12, 0x5b, 0x5c])
  child.stdout.write(JSON.stringify({ id: paste.id, value: 'ok' }) + '\n')
  await send
  assert.equal(spawns(), 1)
}))

test('missing target never sends a shortcut', () => fixture(async (input, child, spawns) => {
  await assert.rejects(input.send(null, 0x56), /campo de destino/)
  assert.equal(spawns(), 0)
  assert.equal(child.requests.length, 0)
}))

test('lost editor reports a recoverable error without retrying paste', () => fixture(async (input, child) => {
  const ready = input.start()
  child.stdout.write('READY\n')
  await ready
  const sending = input.send('expired-token', 0x56)
  const rejected = assert.rejects(sending, /campo de texto original/)
  await Promise.resolve()
  child.stdout.write(JSON.stringify({ id: child.requests.at(-1).id, error: 'focus' }) + '\n')
  await rejected
  assert.equal(child.requests.length, 1)
}))

test('worker exit rejects pending operations instead of leaving them stuck', () => fixture(async (input, child) => {
  const ready = input.start()
  child.stdout.write('READY\n')
  await ready
  const capture = input.capture()
  const rejected = assert.rejects(capture, /control de escritura/)
  await Promise.resolve()
  child.kill()
  await rejected
}))

test('synchronous spawn failure permits a subsequent start', async () => {
  let attempts = 0
  const replacement = mock.method(childProcess, 'spawn', () => { attempts++; throw new Error('spawn blocked') })
  syncBuiltinESMExports()
  const input = new WindowsInput()
  try {
    await assert.rejects(input.start(), /spawn blocked/)
    await assert.rejects(input.start(), /spawn blocked/)
    assert.equal(attempts, 2)
  } finally { replacement.mock.restore(); syncBuiltinESMExports() }
})

test('an unresponsive provider is killed so it cannot paste after timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await fixture(async (input, child) => {
    const ready = input.start()
    child.stdout.write('READY\n')
    await ready
    const sending = input.send('editor-token', 0x56)
    const rejected = assert.rejects(sending, /control de escritura/)
    await Promise.resolve()
    t.mock.timers.tick(6001)
    await rejected
    assert.equal(child.requests.length, 1)
  })
})

test('foreground, panel and editor failures remain distinguishable', () => {
  assert.match(inputErrorMessage('foreground'), /Windows no permitió volver/)
  assert.match(inputErrorMessage('native-focus'), /activar el panel/)
  assert.match(inputErrorMessage('editor-gone'), /ya no está disponible/)
  assert.match(inputErrorMessage('editor-focus'), /campo de texto original/)
})
