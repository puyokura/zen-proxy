#!/usr/bin/env node
/**
 * warp-relay — a local HTTP CONNECT relay that puts a proxy hop (Cloudflare
 * WARP in proxy mode) in front of zen-proxy's upstream calls, with a direct
 * fallback when the hop is unavailable.
 *
 * Zero dependencies: node:http + node:net only.
 *
 *   node scripts/warp-relay.mjs --listen 127.0.0.1:8890 \
 *        --hop http://127.0.0.1:40000 --fallback direct
 *
 * Why a relay and not "HTTPS_PROXY=http://127.0.0.1:40000" straight in the
 * zen-proxy unit: Node's env proxy (NODE_USE_ENV_PROXY=1 + HTTPS_PROXY) is
 * process-wide and has no failover, so a stopped WARP service would take every
 * upstream call down with it. The relay keeps one stable address for
 * zen-proxy and picks the hop or a direct socket per tunnel.
 *
 * Endpoints:
 *   CONNECT host:port   tunneled through the hop, or direct when the hop fails
 *   GET /__status       JSON counters
 */
import http from "node:http"
import net from "node:net"
import process from "node:process"

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith("--")) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith("--")) {
      out[key] = true
    } else {
      out[key] = next
      i++
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

export function createRelay(options = {}) {
  const listenHost = options.listenHost ?? "127.0.0.1"
  const listenPort = Number(options.listenPort ?? 8890)
  const hopUrl = options.hop ?? ""
  const fallback = options.fallback ?? "direct"
  const connectTimeoutMs = Number(options.connectTimeoutMs ?? 15000)
  const log = options.log ?? (() => {})

  const stats = {
    startedAt: new Date().toISOString(),
    tunnels: 0,
    viaHop: 0,
    viaDirect: 0,
    fallbacks: 0,
    failed: 0,
    lastTarget: "",
    lastPath: "",
    hopUrl,
    fallback,
  }

  let hopTarget = null
  if (hopUrl) {
    const u = new URL(hopUrl)
    hopTarget = { host: u.hostname, port: Number(u.port || (u.protocol === "https:" ? 443 : 80)) }
  }

  function connectDirect(host, port) {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host, port })
      socket.setTimeout(connectTimeoutMs)
      const onError = (err) => {
        socket.destroy()
        reject(err)
      }
      socket.once("error", onError)
      socket.once("timeout", () => {
        socket.destroy()
        reject(new Error("direct connect timed out"))
      })
      socket.once("connect", () => {
        socket.removeListener("error", onError)
        socket.setTimeout(0)
        resolve(socket)
      })
    })
  }

  // Tunnel to the target *through* the hop proxy with an HTTP CONNECT.
  function connectViaHop(host, port) {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: hopTarget.host, port: hopTarget.port })
      socket.setTimeout(connectTimeoutMs)
      let buf = Buffer.alloc(0)
      const fail = (err) => {
        socket.destroy()
        reject(err)
      }
      socket.once("error", fail)
      socket.once("timeout", () => fail(new Error("hop connect timed out")))
      socket.once("connect", () => {
        socket.setTimeout(0)
        socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`)
      })
      const onData = (chunk) => {
        buf = Buffer.concat([buf, chunk])
        const end = buf.indexOf("\r\n\r\n")
        if (end === -1) return
        socket.removeListener("data", onData)
        const head = buf.subarray(0, end).toString("latin1")
        const status = Number(head.split(" ")[1] || 0)
        if (status >= 200 && status < 300) {
          const rest = buf.subarray(end + 4)
          if (rest.length) socket.unshift(rest)
          resolve(socket)
        } else {
          fail(new Error(`hop refused CONNECT (${status})`))
        }
      }
      socket.on("data", onData)
    })
  }

  async function openTunnel(host, port) {
    if (hopTarget) {
      try {
        const socket = await connectViaHop(host, port)
        return { socket, path: "hop" }
      } catch (err) {
        stats.fallbacks++
        log(`hop failed for ${host}:${port} (${err.message}); falling back to ${fallback}`)
        if (fallback !== "direct") throw err
      }
    }
    const socket = await connectDirect(host, port)
    return { socket, path: hopTarget ? "direct" : "direct" }
  }

  const server = http.createServer((req, res) => {
    if (req.url === "/__status") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ ...stats, uptimeSec: Math.round(process.uptime()) }, null, 2))
      return
    }
    res.writeHead(405, { "content-type": "text/plain" })
    res.end("this endpoint only speaks HTTP CONNECT\n")
  })

  server.on("connect", (req, clientSocket, head) => {
    const target = String(req.url || "")
    const idx = target.lastIndexOf(":")
    const host = idx === -1 ? target : target.slice(0, idx)
    const port = idx === -1 ? 443 : Number(target.slice(idx + 1))
    stats.tunnels++
    stats.lastTarget = `${host}:${port}`

    clientSocket.on("error", () => {})
    openTunnel(host, port).then(({ socket, path }) => {
      stats.lastPath = path
      if (path === "hop") stats.viaHop++
      else stats.viaDirect++
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head && head.length) socket.write(head)
      socket.on("error", () => clientSocket.destroy())
      clientSocket.on("error", () => socket.destroy())
      socket.pipe(clientSocket)
      clientSocket.pipe(socket)
    }).catch((err) => {
      stats.failed++
      log(`tunnel failed for ${host}:${port}: ${err.message}`)
      try {
        clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n")
      } catch {}
      clientSocket.destroy()
    })
  })

  return {
    server,
    stats,
    listen: () =>
      new Promise((resolve) => {
        server.listen(listenPort, listenHost, () => resolve(server.address()))
      }),
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
      }),
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  const relay = createRelay({
    listenHost: args["listen-host"] ?? "127.0.0.1",
    listenPort: Number(args.port ?? 8890),
    hop: args.hop === true ? "" : args.hop ?? "",
    fallback: args.fallback === true ? "direct" : args.fallback ?? "direct",
    connectTimeoutMs: Number(args["connect-timeout-ms"] ?? 15000),
    log: (msg) => console.log(`[warp-relay] ${msg}`),
  })
  await relay.listen()
  const addr = relay.server.address()
  console.log(`[warp-relay] listening on http://${addr.address}:${addr.port}`)
  console.log(`[warp-relay] hop=${relay.stats.hopUrl || "(none)"} fallback=${relay.stats.fallback}`)
  const summaryEvery = Number(args["summary-seconds"] ?? 0)
  if (summaryEvery > 0) {
    setInterval(() => {
      const s = relay.stats
      console.log(
        `[warp-relay] tunnels=${s.tunnels} hop=${s.viaHop} direct=${s.viaDirect} fallbacks=${s.fallbacks} failed=${s.failed}`,
      )
    }, summaryEvery * 1000).unref?.()
  }
}
