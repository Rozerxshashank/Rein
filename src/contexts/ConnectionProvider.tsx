"use client"

import type React from "react"
import {
	createContext,
	useContext,
	useEffect,
	useRef,
	useState,
	useCallback,
} from "react"

type ConnectionStatus = "connecting" | "connected" | "disconnected"
type DataChannelStatus = "closed" | "connecting" | "open"

/** Message types that should use unordered (UDP-like) delivery. */
const UNORDERED_TYPES = new Set(["move", "scroll", "zoom", "touch"])

interface ConnectionContextType {
	status: ConnectionStatus
	platform: string | null
	latency: number | null
	sessionId: string
	dcStatus: DataChannelStatus
	send: (msg: unknown) => void
	subscribe: (type: string, callback: (msg: unknown) => void) => () => void
	postSignal: (payload: unknown) => Promise<void>
}

const ConnectionContext = createContext<ConnectionContextType | null>(null)

export const useConnection = () => {
	const context = useContext(ConnectionContext)
	if (!context)
		throw new Error("useConnection must be used within ConnectionProvider")
	return context
}

function generateSessionId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function ConnectionProvider({
	children,
}: { children: React.ReactNode }) {
	const [status, setStatus] = useState<ConnectionStatus>("disconnected")
	const [platform, setPlatform] = useState<string | null>(null)
	const [latency, setLatency] = useState<number | null>(null)
	const [dcStatus, setDcStatus] = useState<DataChannelStatus>("closed")
	const sessionIdRef = useRef(generateSessionId())
	const isMountedRef = useRef(true)
	const subscribersRef = useRef<Record<string, Set<(msg: unknown) => void>>>({})

	// WebRTC refs (mobile only)
	const pcRef = useRef<RTCPeerConnection | null>(null)
	const dcUnorderedRef = useRef<RTCDataChannel | null>(null)
	const dcOrderedRef = useRef<RTCDataChannel | null>(null)
	const sseRef = useRef<EventSource | null>(null)
	const isMobileRef = useRef(false)

	// Reconnection state
	const wasEverDcOpenRef = useRef(false)
	const reconnectCountRef = useRef(0)
	const MAX_RECONNECT = 5

	const subscribe = useCallback(
		(type: string, callback: (msg: unknown) => void) => {
			if (!subscribersRef.current[type]) {
				subscribersRef.current[type] = new Set()
			}
			subscribersRef.current[type].add(callback)
			return () => {
				subscribersRef.current[type].delete(callback)
			}
		},
		[],
	)

	const getAuthToken = useCallback((): string | null => {
		try {
			const urlParams = new URLSearchParams(window.location.search)
			return urlParams.get("token") || localStorage.getItem("rein_auth_token")
		} catch {
			return null
		}
	}, [])

	/** Send a message via WebRTC DataChannel (unordered for move/scroll/zoom, ordered for keys/text/clipboard). */
	const send = useCallback((msg: unknown) => {
		const msgObj = msg as Record<string, unknown>
		const msgType = typeof msgObj?.type === "string" ? msgObj.type : ""

		const isUnordered = UNORDERED_TYPES.has(msgType)
		const dc = isUnordered ? dcUnorderedRef.current : dcOrderedRef.current

		if (dc && dc.readyState === "open") {
			try {
				dc.send(JSON.stringify(msg))
			} catch {
				// DataChannel send failed, drop the message
			}
		}
	}, [])

	const postSignal = useCallback(async (payload: unknown) => {
		await fetch("/api/signal", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				sessionId: sessionIdRef.current,
				payload,
			}),
		})
	}, [])

	/** Create WebRTC peer connection and DataChannels (mobile client). */
	const setupWebRTC = useCallback(async () => {
		const sessionId = sessionIdRef.current

		// Clean up any existing connection
		if (pcRef.current) {
			pcRef.current.close()
			pcRef.current = null
		}
		if (sseRef.current) {
			sseRef.current.close()
			sseRef.current = null
		}

		const pc = new RTCPeerConnection({
			iceServers: [{ urls: "stun:stun1.l.google.com:19302" }],
		})
		pcRef.current = pc

		// Create DataChannels
		// DC_UNORDERED: for move/scroll/zoom — UDP-like, drop stale events
		const dcUnordered = pc.createDataChannel("dc-unordered", {
			ordered: false,
			maxRetransmits: 0,
		})
		dcUnorderedRef.current = dcUnordered

		// DC_ORDERED: for key/text/combo/click/clipboard — TCP-like, reliable
		const dcOrdered = pc.createDataChannel("dc-ordered", {
			ordered: true,
		})
		dcOrderedRef.current = dcOrdered

		const updateDcStatus = () => {
			if (!isMountedRef.current) return
			const uState = dcUnorderedRef.current?.readyState
			const oState = dcOrderedRef.current?.readyState
			if (uState === "open" && oState === "open") {
				setDcStatus("open")
			} else if (uState === "connecting" || oState === "connecting") {
				setDcStatus("connecting")
			} else {
				setDcStatus("closed")
			}
		}

		dcUnordered.onopen = updateDcStatus
		dcUnordered.onclose = updateDcStatus
		dcOrdered.onopen = updateDcStatus
		dcOrdered.onclose = updateDcStatus

		// Handle incoming media tracks (screen mirror from desktop)
		pc.ontrack = (e) => {
			if (e.streams?.[0]) {
				const subs = subscribersRef.current["mirror-stream"]
				if (subs) {
					for (const cb of subs) cb(e.streams[0])
				}
			}
		}

		// ICE candidate → send to signaling server
		pc.onicecandidate = (e) => {
			if (e.candidate) {
				postSignal({
					type: "webrtc-signaling",
					signalingType: "ice-candidate",
					candidate: e.candidate,
					from: sessionId,
				})
			}
		}

		pc.onconnectionstatechange = () => {
			console.log(`[Client WebRTC] Connection state: ${pc.connectionState}`)
			if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
				setDcStatus("closed")
			}
		}

		setDcStatus("connecting")

		// Subscribe to SSE FIRST so we receive the answer in real-time
		const sseUrl = `/api/signal/ice?sessionId=${encodeURIComponent(sessionId)}`
		const sse = new EventSource(sseUrl)
		sseRef.current = sse

		sse.onmessage = async (event) => {
			try {
				const signal = JSON.parse(event.data)
				if (signal.type !== "webrtc-signaling" || signal.from === sessionId) {
					// Handle non-signaling messages (e.g., start-mirror, stop-mirror)
					if (signal.type === "start-mirror" && signal.from !== sessionId) {
						const subs = subscribersRef.current["mirror-status"]
						if (subs) for (const cb of subs) cb("negotiating")
					} else if (signal.type === "stop-mirror") {
						const subs = subscribersRef.current["mirror-status"]
						if (subs) for (const cb of subs) cb("idle")
						const streamSubs = subscribersRef.current["mirror-stream"]
						if (streamSubs) for (const cb of streamSubs) cb(null)
					}
					return
				}

				if (signal.signalingType === "answer" && pcRef.current) {
					if (pcRef.current.signalingState === "have-local-offer") {
						await pcRef.current.setRemoteDescription(signal.sdp)
					}
				} else if (signal.signalingType === "offer" && pcRef.current) {
					// Desktop sent a renegotiation offer (e.g., adding media track)
					await pcRef.current.setRemoteDescription(signal.sdp)
					const answer = await pcRef.current.createAnswer()
					await pcRef.current.setLocalDescription(answer)
					await postSignal({
						type: "webrtc-signaling",
						signalingType: "answer",
						sdp: answer,
						from: sessionId,
					})
				} else if (signal.signalingType === "ice-candidate" && pcRef.current) {
					try {
						await pcRef.current.addIceCandidate(signal.candidate)
					} catch {
						// Ignore ICE errors for candidates arriving early
					}
				}
			} catch {
				// Ignore parse errors
			}
		}

		sse.onerror = () => {
			console.warn("[Client SSE] Connection error, will auto-reconnect")
		}

		// THEN create and send the offer (answer will arrive via SSE above)
		const offer = await pc.createOffer()
		await pc.setLocalDescription(offer)

		await postSignal({
			type: "webrtc-signaling",
			signalingType: "offer",
			sdp: offer,
			from: sessionId,
		})
	}, [postSignal])

	// ── Bootstrap ────────────────────────────────────────────────
	useEffect(() => {
		isMountedRef.current = true
		isMobileRef.current = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

		const token = getAuthToken()
		if (token) {
			try {
				const urlToken = new URLSearchParams(window.location.search).get("token")
				if (urlToken) localStorage.setItem("rein_auth_token", urlToken)
			} catch {}
		}

		fetch("/api/ip")
			.then((r) => r.json())
			.then(() => {
				if (isMountedRef.current) {
					setStatus("connected")
					setPlatform(null)

					// On mobile: set up WebRTC
					if (isMobileRef.current) {
						setupWebRTC().catch((err) => {
							console.error("[Client WebRTC] Setup failed:", err)
						})
					}
				}
			})
			.catch(() => {
				if (isMountedRef.current) setStatus("disconnected")
			})

		return () => {
			isMountedRef.current = false
			if (pcRef.current) {
				pcRef.current.close()
				pcRef.current = null
			}
			if (sseRef.current) {
				sseRef.current.close()
				sseRef.current = null
			}
		}
	}, [getAuthToken, setupWebRTC])

	// ── Track successful DC connections ──────────────────────────
	useEffect(() => {
		if (dcStatus === "open") {
			wasEverDcOpenRef.current = true
			reconnectCountRef.current = 0
		}
	}, [dcStatus])

	// ── Auto-reconnect when WebRTC drops (mobile only) ──────────
	useEffect(() => {
		if (!isMobileRef.current) return
		if (status !== "connected") return
		if (dcStatus !== "closed") return
		if (!wasEverDcOpenRef.current) return
		if (reconnectCountRef.current >= MAX_RECONNECT) return

		reconnectCountRef.current += 1
		const attempt = reconnectCountRef.current
		const delay = Math.min(1500 * Math.pow(1.5, attempt - 1), 8000)

		console.log(`[Client WebRTC] Auto-reconnecting (attempt ${attempt}/${MAX_RECONNECT}) in ${Math.round(delay)}ms...`)

		const timer = setTimeout(() => {
			if (isMountedRef.current && isMobileRef.current) {
				setupWebRTC().catch((err) => {
					console.error("[Client WebRTC] Reconnect failed:", err)
				})
			}
		}, delay)

		return () => clearTimeout(timer)
	}, [dcStatus, status, setupWebRTC])

	// ── Latency measurement ──────────────────────────────────────
	useEffect(() => {
		if (status !== "connected") {
			setLatency(null)
			return
		}

		const measureLatency = async () => {
			const start = Date.now()
			try {
				await fetch("/api/ip")
				if (isMountedRef.current) {
					setLatency(Date.now() - start)
				}
			} catch {
				if (isMountedRef.current) setLatency(null)
			}
		}

		measureLatency()
		const interval = setInterval(measureLatency, 2000)

		return () => clearInterval(interval)
	}, [status])

	return (
		<ConnectionContext.Provider
			value={{
				status,
				platform,
				latency,
				sessionId: sessionIdRef.current,
				dcStatus,
				send,
				subscribe,
				postSignal,
			}}
		>
			{children}
		</ConnectionContext.Provider>
	)
}
