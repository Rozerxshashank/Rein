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

	if (path === "/api/ip" && req.method === "GET") {
		json(res, 200, { ip: LAN_IP })
		return true
	}

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
			json(res, 200, { ok: true })
		} catch (e) {
			logger.error(`Failed to parse signal body: ${String(e)}`)
			json(res, 400, { error: "Invalid body" })
		}
		return true
	}

	const signalMatch = path.match(/^\/api\/signal\/(.+)$/)
	if (signalMatch && req.method === "GET") {
		const sessionId = signalMatch[1]
		cleanupSignals()
		const cursor = clientCursors.get(sessionId) || 0
		const newMessages = signalStore.filter(
			(m) => m.id > cursor && m.sessionId !== sessionId
		)
		if (newMessages.length > 0) {
			clientCursors.set(sessionId, newMessages[newMessages.length - 1].id)
		}
		json(res, 200, { messages: newMessages.map((m) => m.payload) })
		return true
	}

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
