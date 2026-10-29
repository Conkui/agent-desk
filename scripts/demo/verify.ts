/** Read-only verification of the small communication demo; never sends a model prompt. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Database } from 'bun:sqlite'
import type { WorkflowRun } from '../../hapi/shared/src/workflows'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const data = join(root, '.local/demo')
const port = Number(process.argv[2] ?? 4181)
assert(Number.isInteger(port) && port > 1023 && port < 65536, 'Invalid port')
const origin = `http://127.0.0.1:${port}`
const accessToken = (await readFile(join(data, 'access-token.txt'), 'utf8')).trim()
const response = await fetch(`${origin}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken }) })
assert(response.ok, 'Local Hub authentication failed')
const auth = await response.json() as { token: string }
async function get<T>(path: string): Promise<T> {
    const result = await fetch(`${origin}${path}`, { headers: { authorization: `Bearer ${auth.token}` }, signal: AbortSignal.timeout(10000) })
    assert(result.ok, `Hub returned ${result.status} for ${path}`)
    return await result.json() as T
}
function record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
type Message = { content: unknown }
function agentData(messages: Message[]): Record<string, unknown>[] {
    return messages.flatMap(message => {
        const envelope = record(message.content)
        const value = envelope?.role === 'agent' ? record(record(envelope.content)?.data) : undefined
        return value ? [value] : []
    })
}
function delivered(messages: Message[], target: string): boolean {
    const events = agentData(messages)
    const calls = new Set(events.filter(event => event.type === 'tool-call' && event.name === 'hapi_ping_peer'
        && typeof record(event.input)?.sessionIdPrefix === 'string' && target.startsWith(record(event.input)!.sessionIdPrefix as string)).map(event => event.callId))
    return events.some(event => event.type === 'tool-call-result' && calls.has(event.callId) && event.is_error === false
        && String(record(event.output)?.output ?? '').startsWith(`Delivered to ${target}`))
}
const selected = JSON.parse(await readFile(join(data, 'verified-team.json'), 'utf8')) as { runId: string }
const run = (await get<{ runs: WorkflowRun[] }>('/api/workflow-runs')).runs.find(item => item.id === selected.runId)
assert(run && run.members.length === 2 && run.members.every(member => member.agent === 'opencode' && member.sessionId), 'Expected two recorded OpenCode sessions')
const coordinator = run.members[0].sessionId!, worker = run.members[1].sessionId!
const histories = await Promise.all([coordinator, worker].map(id => get<{ messages: Message[] }>(`/api/sessions/${id}/messages?limit=100`)))
assert(delivered(histories[0].messages, worker), 'No successful coordinator-to-worker delivery')
assert(delivered(histories[1].messages, coordinator), 'No successful worker-to-coordinator delivery')
assert(histories[0].messages.some(message => { const value = record(message.content); return value?.role === 'user' && record(value.content)?.text === 'worker-ok' }), 'Coordinator did not receive the worker reply')
assert(agentData(histories[0].messages).some(event => event.type === 'message' && String(event.message).includes('团队通信成功')), 'Coordinator final summary is missing')

// Match native DB records to these exact HAPI sessions; a saved profile alone cannot
// prove which model actually ran. SQLite is opened read-only, including the live WAL.
const nativeSessions = await Promise.all([coordinator, worker].map(id => get<{ session: { metadata: { opencodeSessionId: string } } }>(`/api/sessions/${id}`)))
const db = new Database(join(data, 'agent-data/opencode/opencode.db'), { readonly: true })
const models = nativeSessions.map(({ session }) => {
    assert(session.metadata.opencodeSessionId, 'Native OpenCode identity missing')
    const rows = db.query<{ data: string }, [string]>('SELECT data FROM message WHERE session_id = ?').all(session.metadata.opencodeSessionId)
        .map(row => JSON.parse(row.data) as { role: string; modelID?: string; providerID?: string }).filter(message => message.role === 'assistant')
    assert(rows.length && rows.every(message => message.modelID === 'deepseek-flash' && message.providerID === 'hapi-managed'), 'Unexpected native model/provider')
    return { sessionId: session.metadata.opencodeSessionId, model: 'deepseek-flash', provider: 'hapi-managed', assistantRecords: rows.length }
})
db.close()
const report = { verifiedAt: new Date().toISOString(), runId: run.id, hapiSessionIds: [coordinator, worker], bidirectionalDelivery: true, workerReplyReceived: true, coordinatorSummaryReceived: true, nativeModels: models }
await writeFile(join(data, 'verification.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
