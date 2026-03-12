"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export function useCaptureProvider(wsRef: React.RefObject<WebSocket | null>) {
	const [isSharing, setIsSharing] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const streamRef = useRef<MediaStream | null>(null)
	const pcsRef = useRef<Record<string, RTCPeerConnection>>({})
	const myIdRef = useRef<string | null>(null);

	const cleanupPeer = useCallback((id: string) => {
		if (pcsRef.current[id]) {
			pcsRef.current[id].close()
			delete pcsRef.current[id]
		}
	}, [])

	const cleanupAll = useCallback(() => {
		for (const id in pcsRef.current) {
			cleanupPeer(id)
		}
		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) track.stop()
			streamRef.current = null
		}
		setIsSharing(false)
	}, [cleanupPeer])

	const stopSharing = useCallback(() => {
		cleanupAll()
		if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: "stop-mirror" }))
		}
	}, [wsRef, cleanupAll])

	const createPeerConnection = useCallback((targetId: string) => {
		cleanupPeer(targetId)

		const pc = new RTCPeerConnection({
			iceServers: [{ urls: "stun:stun1.l.google.com:19302" }],
		})

		pc.onicecandidate = (event) => {
			if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
				console.log(`[WebRTC] Provider ICE Candidate gathered for ${targetId}`);
				wsRef.current.send(
					JSON.stringify({
						type: "webrtc-signaling",
						target: targetId,
						candidate: event.candidate,
					}),
				)
			}
		}

		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) {
				pc.addTrack(track, streamRef.current)
			}
		}

		pcsRef.current[targetId] = pc
		return pc
	}, [wsRef, cleanupPeer])

	const handleSignaling = useCallback(
		async (msg: any) => {
			const targetId = msg.from
			if (!targetId) return

			let pc = pcsRef.current[targetId]
			if (!pc) {
				console.log(`[WebRTC] Received signaling for unknown peer ${targetId}, ignoring.`);
				return
			}

			try {
				if (msg.offer) {
					console.log(`[WebRTC] Provider received OFFER from ${targetId}`);
					await pc.setRemoteDescription(new RTCSessionDescription(msg.offer))
					const answer = await pc.createAnswer()
					await pc.setLocalDescription(answer)
					wsRef.current?.send(
						JSON.stringify({ type: "webrtc-signaling", target: targetId, answer }),
					)
				} else if (msg.answer) {
					console.log(`[WebRTC] Provider received ANSWER from ${targetId}`);
					await pc.setRemoteDescription(new RTCSessionDescription(msg.answer))
				} else if (msg.candidate) {
					console.log(`[WebRTC] Provider received ICE Candidate from ${targetId}`);
					await pc.addIceCandidate(new RTCIceCandidate(msg.candidate))
				}
			} catch (err) {
				console.error(`WebRTC signaling error for ${targetId}:`, err)
			}
		},
		[wsRef],
	)

	const startSharing = useCallback(async () => {
		setError(null)
		try {
			const stream = await navigator.mediaDevices.getDisplayMedia({
				video: {
					displaySurface: "monitor",
					frameRate: { ideal: 60 },
				},
			})

			streamRef.current = stream
			setIsSharing(true)

			if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
				wsRef.current.send(JSON.stringify({ type: "start-provider" }))
			}

			stream.getVideoTracks()[0].onended = () => {
				stopSharing()
			}
		} catch (err) {
			console.error("Failed to start screen capture:", err)
			setError(err instanceof Error ? err.message : String(err))
			setIsSharing(false)
		}
	}, [wsRef, stopSharing])

	useEffect(() => {
		const ws = wsRef.current
		if (!ws) return

		const onMessage = (event: MessageEvent) => {
			if (typeof event.data !== "string") return
			try {
				const msg = JSON.parse(event.data)
				if (msg.type === "connected") {
					myIdRef.current = msg.clientId;
				} else if (msg.type === "webrtc-signaling") {
					handleSignaling(msg)
				} else if (msg.type === "start-mirror" && isSharing) {
					const consumerId = msg.from
					if (!consumerId) return

					console.log(`[WebRTC] Consumer ${consumerId} joined, creating OFFER`);
					const pc = createPeerConnection(consumerId)
					pc.createOffer().then((offer) => {
						pc.setLocalDescription(offer)
						ws.send(JSON.stringify({ type: "webrtc-signaling", target: consumerId, offer }))
					})
				} else if (msg.type === "stop-mirror") {
					if (msg.from) cleanupPeer(msg.from)
				}
			} catch {}
		}

		ws.addEventListener("message", onMessage)
		return () => {
			ws.removeEventListener("message", onMessage)
			cleanupAll()
		}
	}, [wsRef, handleSignaling, isSharing, createPeerConnection, cleanupAll, cleanupPeer])

	return {
		isSharing,
		error,
		startSharing,
		stopSharing,
	}
}
