#!/usr/bin/env node
/**
 * Local NDJSON log collector for the `debug` plugin.
 *
 * Instrumented code (Node or browser) POSTs JSON payloads here; each entry
 * is appended as one NDJSON line to the output file so the agent can grep
 * runtime evidence instead of flooding its context window.
 *
 * Usage:
 *   node collector.mjs [--port 7244] [--out .debug-mode/logs.ndjson]
 *
 * Endpoints:
 *   POST /log    — body is a JSON object, an NDJSON batch, or plain text
 *                  (navigator.sendBeacon sends text/plain). Returns 204.
 *   GET  /health — returns {ok, seq, out, pid}. Returns 200.
 *   OPTIONS *    — CORS preflight. Returns 204.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const PORT = Number(argOf('--port', '7244'))
const OUT = path.resolve(argOf('--out', '.debug-mode/logs.ndjson'))
const PID_FILE = path.join(path.dirname(OUT), 'collector.pid')
const MAX_LOG_BYTES = 50 * 1024 * 1024 // hard cap so a hot loop can't fill the disk
const MAX_BODY_BYTES = 1 * 1024 * 1024

fs.mkdirSync(path.dirname(OUT), { recursive: true })

let seq = 0
let capped = false

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Private-Network': 'true',
}

function appendEntries(rawBody) {
  if (capped) return
  try {
    if (fs.existsSync(OUT) && fs.statSync(OUT).size > MAX_LOG_BYTES) {
      capped = true
      fs.appendFileSync(
        OUT,
        JSON.stringify({ t: new Date().toISOString(), seq: ++seq, site: 'collector', data: { error: 'max log size reached, dropping further entries' } }) + '\n'
      )
      return
    }
  } catch {
    /* stat race — keep going */
  }

  const lines = rawBody.split('\n').map((l) => l.trim()).filter(Boolean)
  const out = []
  for (const line of lines) {
    let entry
    try {
      const parsed = JSON.parse(line)
      entry = typeof parsed === 'object' && parsed !== null ? parsed : { data: parsed }
    } catch {
      entry = { raw: line }
    }
    out.push(JSON.stringify({ t: new Date().toISOString(), seq: ++seq, ...entry }))
  }
  if (out.length) fs.appendFileSync(OUT, out.join('\n') + '\n')
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    return res.end()
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', ...CORS_HEADERS })
    return res.end(JSON.stringify({ ok: true, seq, out: OUT, pid: process.pid }))
  }

  if (req.method === 'POST' && req.url === '/log') {
    let body = ''
    let dropped = false
    req.on('data', (chunk) => {
      if (dropped) return
      body += chunk
      if (body.length > MAX_BODY_BYTES) {
        dropped = true
        res.writeHead(413, CORS_HEADERS)
        res.end()
        req.destroy()
      }
    })
    req.on('end', () => {
      if (dropped) return
      if (body) appendEntries(body)
      res.writeHead(204, CORS_HEADERS)
      res.end()
    })
    return
  }

  res.writeHead(404, CORS_HEADERS)
  res.end()
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      JSON.stringify({ ok: false, error: `port ${PORT} already in use — check GET http://127.0.0.1:${PORT}/health; if it is a previous collector, reuse it` })
    )
    process.exit(1)
  }
  console.error(JSON.stringify({ ok: false, error: String(err) }))
  process.exit(1)
})

server.listen(PORT, '127.0.0.1', () => {
  fs.writeFileSync(PID_FILE, String(process.pid))
  console.log(JSON.stringify({ ok: true, listening: `http://127.0.0.1:${PORT}`, out: OUT, pid: process.pid }))
})

function shutdown() {
  try {
    if (fs.existsSync(PID_FILE) && fs.readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) {
      fs.unlinkSync(PID_FILE)
    }
  } catch {
    /* best effort */
  }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
