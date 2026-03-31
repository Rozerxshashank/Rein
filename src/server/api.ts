import fs from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import logger from "../utils/logger"
import { InputHandler, type InputMessage } from "./InputHandler"
import { getLocalIp } from "./getLocalIp"
import {
	generateToken,
	getActiveToken,
	isKnownToken,
	storeToken,
} from "./tokenStore"

let LAN_IP = "127.0.0.1"
let inputHandler: InputHandler

interface SignalMessage {
	sessionId: string
	payload: unknown
	timestamp: number
	id: number
}

let signalIdCounter = 0
const signalStore: SignalMessage[] = []
const SIGNAL_TTL_MS = 30_000
const MAX_STORE_SIZE = 200
const clientCursors = new Map<string, number>()

// SSE: Map of sessionId -> Set of SSE response objects
const sseClients = new Map<string, Set<ServerResponse>>()

function cleanupSignals() {
	const now = Date.now()
	while (signalStore.length > 0 && now - signalStore[0].timestamp > SIGNAL_TTL_MS) {
		signalStore.shift()
	}
	while (signalStore.length > MAX_STORE_SIZE) {
		signalStore.shift()
	}
	for (const [cid, cursor] of clientCursors) {
		if (signalStore.length === 0 || cursor < (signalStore[0]?.id ?? 0) - 100) {
			clientCursors.delete(cid)
		}
	}
}

/** Push a signal payload to all SSE listeners for a given sessionId (excluding the sender). */
function broadcastSignalSSE(senderSessionId: string, payload: unknown) {
	for (const [sessionId, clients] of sseClients) {
		if (sessionId === senderSessionId) continue
		for (const res of clients) {
			try {
				const data = JSON.stringify(payload)
				res.write(`data: ${data}\n\n`)
			} catch {
				// Client may have disconnected
			}
		}
	}
}

function isLocalhost(req: IncomingMessage): boolean {
	const addr = req.socket.remoteAddress
	if (!addr) return false
	return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1"
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		let size = 0
		req.on("data", (chunk: Buffer) => {
			size += chunk.length
			if (size > 102400) {
				req.destroy()
				reject(new Error("Body too large"))
			}
			chunks.push(chunk)
		})
		req.on("end", () => resolve(Buffer.concat(chunks).toString()))
		req.on("error", reject)
	})
}

function json(res: ServerResponse, status: number, data: unknown) {
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Access-Control-Allow-Origin": "*",
	})
	res.end(JSON.stringify(data))
}

function cors(res: ServerResponse) {
	res.writeHead(204, {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Access-Control-Max-Age": "86400",
	})
	res.end()
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
	const url = new URL(req.url || "", `http://${req.headers.host}`)
	const path = url.pathname

	if (!path.startsWith("/api/")) return false

	if (req.method === "OPTIONS") {
		cors(res)
		return true
	}

	// ── GET /api/ip ──────────────────────────────────────────────
	if (path === "/api/ip" && req.method === "GET") {
		json(res, 200, { ip: LAN_IP })
		return true
	}

	// ── POST /api/token ──────────────────────────────────────────
	if (path === "/api/token" && req.method === "POST") {
		if (!isLocalhost(req)) {
			json(res, 403, { error: "Forbidden" })
			return true
		}
		const token = getActiveToken() || generateToken()
		storeToken(token)
		json(res, 200, { token })
		return true
	}

	// ── POST /api/token/verify ───────────────────────────────────
	if (path === "/api/token/verify" && req.method === "POST") {
		try {
			const body = JSON.parse(await readBody(req))
			const valid = body.token && isKnownToken(body.token)
			json(res, 200, { valid })
		} catch {
			json(res, 400, { error: "Invalid body" })
		}
		return true
	}

	// ── POST /api/signal ─────────────────────────────────────────
	if (path === "/api/signal" && req.method === "POST") {
		try {
			const body = JSON.parse(await readBody(req))
			const { sessionId, payload } = body
			if (!sessionId || !payload) {
				json(res, 400, { error: "Missing sessionId or payload" })
				return true
			}
			signalIdCounter++
			signalStore.push({ sessionId, payload, timestamp: Date.now(), id: signalIdCounter })
			while (signalStore.length > MAX_STORE_SIZE) signalStore.shift()

			// Push to all SSE listeners (excluding sender)
			broadcastSignalSSE(sessionId, payload)

			json(res, 200, { ok: true })
		} catch (e) {
			logger.error(`Failed to parse signal body: ${String(e)}`)
			json(res, 400, { error: "Invalid body" })
		}
		return true
	}

	// ── GET /api/signal/ice (SSE) ────────────────────────────────
	if (path === "/api/signal/ice" && req.method === "GET") {
		const sessionId = url.searchParams.get("sessionId")
		if (!sessionId) {
			json(res, 400, { error: "Missing sessionId query parameter" })
			return true
		}

		// Set up SSE headers
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			"Connection": "keep-alive",
			"Access-Control-Allow-Origin": "*",
			"X-Accel-Buffering": "no",
		})
		res.write("\n")

		// Register this client
		if (!sseClients.has(sessionId)) {
			sseClients.set(sessionId, new Set())
		}
		sseClients.get(sessionId)!.add(res)
		logger.info(`SSE client connected: ${sessionId}`)

		// For new sessions, start from current position (don't replay stale signals)
		const cursor = clientCursors.get(sessionId) ?? signalIdCounter
		const pending = signalStore.filter(
			(m) => m.id > cursor && m.sessionId !== sessionId
		)
		for (const msg of pending) {
			const data = JSON.stringify(msg.payload)
			res.write(`data: ${data}\n\n`)
		}
		if (pending.length > 0) {
			clientCursors.set(sessionId, pending[pending.length - 1].id)
		}

		// Heartbeat to keep connection alive
		const heartbeat = setInterval(() => {
			try {
				res.write(": heartbeat\n\n")
			} catch {
				clearInterval(heartbeat)
			}
		}, 15_000)

		// Clean up on disconnect
		const cleanup = () => {
			clearInterval(heartbeat)
			const clients = sseClients.get(sessionId)
			if (clients) {
				clients.delete(res)
				if (clients.size === 0) {
					sseClients.delete(sessionId)
				}
			}
			logger.info(`SSE client disconnected: ${sessionId}`)
		}

		req.on("close", cleanup)
		req.on("error", cleanup)

		return true
	}

	// ── POST /api/input ──────────────────────────────────────────
	if (path === "/api/input" && req.method === "POST") {
		try {
			const body = JSON.parse(await readBody(req))
			const token = req.headers.authorization?.replace("Bearer ", "")
			if (token && !isKnownToken(token) && !isLocalhost(req)) {
				json(res, 401, { error: "Unauthorized" })
				return true
			}
			await inputHandler.handleMessage(body as InputMessage)
			json(res, 200, { ok: true })
		} catch {
			json(res, 400, { error: "Invalid input" })
		}
		return true
	}

	// ── POST /api/config ─────────────────────────────────────────
	if (path === "/api/config" && req.method === "POST") {
		if (!isLocalhost(req)) {
			json(res, 403, { error: "Forbidden" })
			return true
		}
		try {
			const body = JSON.parse(await readBody(req))
			const configPath = "./src/server-config.json"
			let config: Record<string, unknown> = {}
			if (fs.existsSync(configPath)) {
				try {
					config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>
				} catch {
					// ignore parse errors on existing file
				}
			}
			if (typeof body.frontendPort === "number") {
				config.frontendPort = body.frontendPort
			}
			fs.writeFileSync(configPath, JSON.stringify(config, null, "\t"), "utf-8")
			json(res, 200, { ok: true })
		} catch {
			json(res, 400, { error: "Invalid config body" })
		}
		return true
	}

	json(res, 404, { error: "Not found" })
	return true
}

export async function createApiServer(
	server: NonNullable<import("vite").ViteDevServer["httpServer"]>,
) {
	logger.info("Initializing HTTP API server...")

	const configPath = "./src/server-config.json"
	let serverConfig: Record<string, unknown> = {}
	if (fs.existsSync(configPath)) {
		try {
			serverConfig = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>
		} catch (e) {
			logger.warn(`Invalid server-config.json, using defaults: ${String(e)}`)
		}
	}

	const inputThrottleMs =
		typeof serverConfig.inputThrottleMs === "number" && serverConfig.inputThrottleMs > 0
			? serverConfig.inputThrottleMs
			: 8

	inputHandler = new InputHandler(inputThrottleMs)

	try {
		LAN_IP = await getLocalIp()
	} catch (error) {
		logger.warn(`Failed to resolve LAN IP: ${String(error)}`)
	}

	if (LAN_IP === "127.0.0.1") {
		logger.warn("LAN IP resolution fell back to localhost (127.0.0.1)")
	} else {
		logger.info(`Resolved LAN IP: ${LAN_IP}`)
	}

	const listeners = server.listeners("request").slice()
	server.removeAllListeners("request")

	server.on("request", async (req: IncomingMessage, res: ServerResponse) => {
		try {
			const handled = await handleRequest(req, res)
			if (handled) return
		} catch (err) {
			logger.error(`API error: ${String(err)}`)
		}

		for (const listener of listeners) {
			;(listener as (req: IncomingMessage, res: ServerResponse) => void)(req, res)
		}
	})

	setInterval(cleanupSignals, 10_000)

	logger.info("HTTP API server initialized")
}
