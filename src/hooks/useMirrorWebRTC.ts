"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export function useMirrorWebRTC(
	wsRef: React.RefObject<WebSocket | null>,
	status: "connecting" | "connected" | "disconnected",
) {
	const [stream, setStream] = useState<MediaStream | null>(null)
	const [isConnecting, setIsConnecting] = useState(false)
	const pcRef = useRef<RTCPeerConnection | null>(null)
	const providerIdRef = useRef<string | null>(null)
	const myIdRef = useRef<string | null>(null)

	const cleanup = useCallback(() => {
		if (pcRef.current) {
			pcRef.current.close()
			pcRef.current = null
		}
		setStream(null)
		setIsConnecting(false)
		providerIdRef.current = null
	}, [])

	const createPeerConnection = useCallback(() => {
		if (pcRef.current) pcRef.current.close()

		const pc = new RTCPeerConnection({
			iceServers: [{ urls: "stun:stun1.l.google.com:19302" }],
		})

		pc.onicecandidate = (event) => {
			if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN && providerIdRef.current) {
				console.log("[WebRTC] Consumer ICE Candidate gathered");
				wsRef.current.send(
					JSON.stringify({
						type: "webrtc-signaling",
						target: providerIdRef.current,
						candidate: event.candidate,
					}),
				)
			}
		}

		pc.ontrack = (event) => {
			if (event.streams && event.streams[0]) {
				console.log("[WebRTC] Consumer received remote track");
				setStream(event.streams[0])
				setIsConnecting(false)
			}
		}

		pc.oniceconnectionstatechange = () => {
			console.log(`[WebRTC] ICE Connection State: ${pc.iceConnectionState}`);
			if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
				cleanup()
			}
		}

		pcRef.current = pc
		return pc
	}, [wsRef, cleanup])

	const handleSignaling = useCallback(
		async (msg: any) => {
			try {
				if (msg.offer) {
					console.log(`[WebRTC] Consumer received OFFER from ${msg.from}`);
					providerIdRef.current = msg.from
					const pc = createPeerConnection()
					await pc.setRemoteDescription(new RTCSessionDescription(msg.offer))
					const answer = await pc.createAnswer()
					await pc.setLocalDescription(answer)
					wsRef.current?.send(
						JSON.stringify({ type: "webrtc-signaling", target: msg.from, answer }),
					)
				} else if (msg.answer) {
					console.log(`[WebRTC] Consumer received ANSWER from ${msg.from}`);
					if (pcRef.current) await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.answer))
				} else if (msg.candidate) {
					console.log(`[WebRTC] Consumer received ICE Candidate from ${msg.from}`);
					if (pcRef.current) await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate))
				}
			} catch (err) {
				console.error("Consumer WebRTC signaling error:", err)
			}
		},
		[wsRef, createPeerConnection],
	)

	useEffect(() => {
		const ws = wsRef.current
		if (!ws || status !== "connected") {
			cleanup()
			return
		}

		const onMessage = (event: MessageEvent) => {
			if (typeof event.data !== "string") return
			try {
				const msg = JSON.parse(event.data)
				if (msg.type === "connected") {
					myIdRef.current = msg.clientId;
				} else if (msg.type === "webrtc-signaling") {
					handleSignaling(msg)
				}
			} catch {}
		}

		ws.addEventListener("message", onMessage)
		setIsConnecting(true)
		
		// Notify provider that we are ready to consume
		console.log("[WebRTC] Sending start-mirror to provider...");
		ws.send(JSON.stringify({ type: "start-mirror" }))

		return () => {
			ws.removeEventListener("message", onMessage)
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: "stop-mirror" }))
			}
			cleanup()
		}
	}, [wsRef, status, handleSignaling, cleanup])

	return { stream, isConnecting }
}
