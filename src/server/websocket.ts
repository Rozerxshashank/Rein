import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import type { Socket } from "node:net"
import { WebSocket, WebSocketServer } from "ws"
import logger from "../utils/logger"
import { InputHandler, type InputMessage } from "./InputHandler"
import { getLocalIp } from "./getLocalIp"
import {
	generateToken,
	getActiveToken,
	isKnownToken,
	storeToken,
	touchToken,
} from "./tokenStore"

interface ExtWebSocket extends WebSocket {
	isConsumer?: boolean
	isProvider?: boolean
}

function isLocalhost(request: IncomingMessage): boolean {
	const addr = request.socket.remoteAddress
	if (!addr) return false
	return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1"
}

export async function createWsServer(
	server: NonNullable<import("vite").ViteDevServer["httpServer"]>,
) {
	logger.info("Initializing WebSocket server...")
	try {
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

		const wss = new WebSocketServer({ noServer: true })
		const inputHandler = new InputHandler(inputThrottleMs)
		
		let LAN_IP = "127.0.0.1"
		try {
			LAN_IP = await getLocalIp()
		} catch (error) {
			logger.warn(`Failed to resolve LAN IP, using localhost: ${String(error)}`)
		}

		if (LAN_IP === "127.0.0.1") {
			logger.warn("LAN IP resolution fell back to localhost (127.0.0.1)")
		} else {
			logger.info(`Resolved LAN IP: ${LAN_IP}`)
		}

		const MAX_PAYLOAD_SIZE = 10 * 1024

		server.on("upgrade", (request: IncomingMessage, socket: Socket, head: Buffer) => {
			const url = new URL(request.url || "", `http://${request.headers.host}`)
			if (url.pathname !== "/ws") return

			const token = url.searchParams.get("token")
			const local = isLocalhost(request)

			logger.info(`Upgrade request received from ${request.socket.remoteAddress}`)

			if (local) {
				wss.handleUpgrade(request, socket, head, (ws) => {
					wss.emit("connection", ws, request, token, true)
				})
				return
			}

			if (!token || !isKnownToken(token)) {
				logger.warn("Unauthorized connection attempt")
				socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
				socket.destroy()
				return
			}

			wss.handleUpgrade(request, socket, head, (ws) => {
				wss.emit("connection", ws, request, token, false)
			})
		})

		wss.on("connection", (ws: WebSocket, request: IncomingMessage, token: string | null, isLocal: boolean) => {
			logger.info(`Client connected from ${request.socket.remoteAddress}`)

			if (token && (isKnownToken(token) || !isLocal)) {
				storeToken(token)
			}

			ws.send(JSON.stringify({ type: "connected", serverIp: LAN_IP }))

			let lastTokenTouch = 0

			const startMirror = () => {
				;(ws as ExtWebSocket).isConsumer = true
				logger.info("Client started consuming mirror")
			}

			const stopMirror = () => {
				;(ws as ExtWebSocket).isConsumer = false
				logger.info("Client stopped consuming mirror")
			}

			ws.on("message", async (data: WebSocket.RawData, isBinary: boolean) => {
				try {
					if (isBinary) {
						if ((ws as ExtWebSocket).isProvider) {
							for (const client of wss.clients) {
								if (client !== ws && (client as ExtWebSocket).isConsumer && client.readyState === WebSocket.OPEN) {
									client.send(data, { binary: true })
								}
							}
						}
						return
					}
					const raw = data.toString()
					if (raw.length > MAX_PAYLOAD_SIZE) return
					const msg = JSON.parse(raw)

					if (token && msg.type !== "get-ip" && msg.type !== "generate-token") {
						const now = Date.now()
						if (now - lastTokenTouch > 1000) {
							lastTokenTouch = now
							touchToken(token)
						}
					}

					if (msg.type === "get-ip") {
						ws.send(JSON.stringify({ type: "server-ip", ip: LAN_IP }))
					} else if (msg.type === "generate-token") {
						if (!isLocal) return
						let tokenToReturn = getActiveToken() || generateToken()
						storeToken(tokenToReturn)
						ws.send(JSON.stringify({ type: "token-generated", token: tokenToReturn }))
					} else if (msg.type === "ping") {
						ws.send(JSON.stringify({ type: "pong", timestamp: msg.timestamp }))
					} else if (msg.type === "start-mirror") {
						startMirror()
						for (const client of wss.clients) {
							if (client !== ws && client.readyState === WebSocket.OPEN) {
								client.send(raw)
							}
						}
					} else if (msg.type === "stop-mirror") {
						stopMirror()
						for (const client of wss.clients) {
							if (client !== ws && client.readyState === WebSocket.OPEN) {
								client.send(raw)
							}
						}
					} else if (msg.type === "start-provider") {
						;(ws as ExtWebSocket).isProvider = true
					} else if (msg.type === "webrtc-signaling") {
						for (const client of wss.clients) {
							if (client !== ws && client.readyState === WebSocket.OPEN) {
								client.send(JSON.stringify(msg))
							}
						}
					} else {
						await inputHandler.handleMessage(msg as InputMessage)
					}
				} catch (err) {
					logger.error(`Error processing message: ${String(err)}`)
				}
			})

			ws.on("close", () => {
				stopMirror()
				logger.info("Client disconnected")
			})
		})

		logger.info("WebSocket server fully initialized")
	} catch (e) {
		logger.error(`CRITICAL SERVER ERROR: ${String(e)}`)
		console.error("[WS] Fatal initialization error:", e)
	}
}
