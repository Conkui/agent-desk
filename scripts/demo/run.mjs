import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const bun = option('--bun', 'bun')
const port = Number(option('--port', '4181'))
const workspace = resolve(option('--workspace', root))
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port')
if (!(await stat(workspace)).isDirectory()) throw new Error('Invalid workspace')
const data = join(root, '.local/demo')
await mkdir(data, { recursive: true, mode: 0o700 })
const binDir = join(data, 'bin')
const tempDir = join(data, 'temp')
await mkdir(binDir, { recursive: true })
await mkdir(tempDir, { recursive: true })
// Make upstream's peer tools usable from every CLI's shell without a global install.
if (process.platform === 'win32') {
    await writeFile(join(binDir, 'hapi.cmd'), `@echo off\r\n"${bun}" --cwd "${join(root, 'hapi/cli')}" "${join(root, 'hapi/cli/src/index.ts')}" %*\r\n`)
} else {
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`
    await writeFile(join(binDir, 'hapi'), `#!/bin/sh\nexec ${quote(bun)} --cwd ${quote(join(root, 'hapi/cli'))} ${quote(join(root, 'hapi/cli/src/index.ts'))} "$@"\n`, { mode: 0o700 })
}
// Fail before launching anything if this address belongs to another process.
const probe = createServer()
await new Promise((ok, fail) => { probe.once('error', fail); probe.listen(port, '127.0.0.1', ok) })
await new Promise(ok => probe.close(ok))
const keyPath = join(data, 'access-token.txt')
let accessToken
try { accessToken = (await readFile(keyPath, 'utf8')).trim() }
catch (error) {
    if (error.code !== 'ENOENT') throw error
    accessToken = randomBytes(32).toString('hex')
    await writeFile(keyPath, accessToken, { mode: 0o600, flag: 'wx' })
}
if (!accessToken) throw new Error('Empty access-token.txt; restore the local pairing key before starting')
const url = `http://127.0.0.1:${port}`
const publicUrl = option('--public-url', url).replace(/\/$/, '')
const parsedPublicUrl = new URL(publicUrl)
if (publicUrl !== url && (parsedPublicUrl.protocol !== 'https:' || parsedPublicUrl.username || parsedPublicUrl.password || parsedPublicUrl.pathname !== '/' || parsedPublicUrl.search || parsedPublicUrl.hash)) throw new Error('Public URL must be an HTTPS origin without credentials, path, query or fragment')
// Do not inherit optional public relay/push/Telegram settings into this local demo.
const env = { ...process.env, HAPI_HOME: data, HAPI_API_URL: url, CLI_API_TOKEN: accessToken,
    PATH: [binDir, join(root, '.local/agents/node_modules/.bin'), process.env.PATH ?? ''].join(process.platform === 'win32' ? ';' : ':'),
    TEMP: tempDir, TMP: tempDir, TMPDIR: tempDir,
    XDG_DATA_HOME: join(data, 'agent-data'), XDG_CACHE_HOME: join(data, 'agent-cache'), XDG_STATE_HOME: join(data, 'agent-state'),
    XDG_CONFIG_HOME: join(data, 'agent-config'), npm_config_cache: join(root, '.local/npm-cache'), BUN_INSTALL_CACHE_DIR: join(root, '.local/bun-cache'),
    CORS_ORIGINS: [...new Set([url, publicUrl])].join(','),
    HAPI_LISTEN_HOST: '127.0.0.1', HAPI_LISTEN_PORT: String(port), HAPI_PUBLIC_URL: publicUrl,
    TELEGRAM_BOT_TOKEN: '', TELEGRAM_NOTIFICATION: 'false', HAPI_ANDROID_PUSH: 'off', HAPI_IOS_PUSH: 'off' }
const children = []
let stopping = false
function launch(name, cwd, argv) {
    const log = createWriteStream(join(data, `${name}.log`), { flags: 'a', mode: 0o600 })
    const child = spawn(bun, ['--cwd', cwd, ...argv], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false })
    child.on('error', () => { console.error(`${name} failed to launch. See ${name}.log`); void stop(1) })
    child.on('exit', (code) => { log.end(); if (!stopping) { console.error(`${name} exited (${code}). See ${name}.log`); void stop(1) } })
    return child
}
async function stop(code = 0) {
    if (stopping) return
    stopping = true
    // Stop only children we created. Runner-owned sessions intentionally remain resumable.
    await Promise.all(children.map(child => new Promise(ok => {
        if (child.exitCode !== null) return ok()
        child.once('exit', ok); child.kill('SIGTERM'); setTimeout(ok, 3000).unref()
    })))
    process.exit(code)
}
process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
launch('hub', join(root, 'hapi/hub'), ['src/index.ts'])
let token
for (let attempt = 0; attempt < 60; attempt++) {
    if (stopping) break
    try {
        const response = await fetch(`${url}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken }), signal: AbortSignal.timeout(1000) })
        if (response.ok) { token = (await response.json()).token; break }
    } catch { /* Hub is still starting. */ }
    await new Promise(ok => setTimeout(ok, 500))
}
if (!token) { console.error('Hub startup timed out. Inspect .local/demo/hub.log.'); await stop(1) }
launch('runner', join(root, 'hapi/cli'), ['src/index.ts', 'runner', 'start-sync', '--workspace-root', workspace])
let available = false
for (let attempt = 0; attempt < 60; attempt++) {
    if (stopping) break
    try {
        const response = await fetch(`${url}/api/machines`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000) })
        const machines = (await response.json()).machines ?? []
        if (machines.length) {
            const scan = await fetch(`${url}/api/machines/${machines[0].id}/agent-availability`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) })
            const agents = (await scan.json()).agents
            if (agents) {
                console.log(`Detected CLIs: ${agents.filter(agent => agent.available).map(agent => agent.agent).join(', ') || '(none)'}`)
                available = true; break
            }
        }
    } catch { /* Runner RPC registration can lag the first machine heartbeat. */ }
    await new Promise(ok => setTimeout(ok, 500))
}
if (!available) { console.error('Runner startup timed out. Inspect .local/demo/runner.log.'); await stop(1) }
console.log(`Demo ready: ${url}/sessions`)
console.log(`First login: paste the key from ${keyPath}. Do not share this file.`)
console.log(`Allowed workspace: ${workspace}`)
console.log('Keep this terminal open. Ctrl+C stops the Hub and Runner. Agent sessions are managed separately.')
if (!args.includes('--no-browser')) {
    // URL contains no access key; launch the default browser hidden on Windows.
    const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    const argv = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', `${url}/sessions`] : [`${url}/sessions`]
    const browser = spawn(command, argv, { windowsHide: true, stdio: 'ignore' }); browser.on('error', () => {}); browser.unref()
}
