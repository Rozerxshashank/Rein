"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export function useCaptureProvider(wsRef: React.RefObject<WebSocket | null>) {
	const [isSharing, setIsSharing] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const streamRef = useRef<MediaStream | null>(null)
	const pcRef = useRef<RTCPeerConnection | null>(null)

	const cleanup = useCallback(() => {
		if (pcRef.current) {
			pcRef.current.close()
			pcRef.current = null
		}
		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) track.stop()
			streamRef.current = null
		}
		setIsSharing(false)
	}, [])

	const stopSharing = useCallback(() => {
		cleanup()
		if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: "stop-mirror" }))
		}
	}, [wsRef, cleanup])

	const createPeerConnection = useCallback(() => {
		if (pcRef.current) pcRef.current.close()

		const pc = new RTCPeerConnection({
			iceServers: [{ urls: "stun:stun1.l.google.com:19302" }],
		})

		pc.onicecandidate = (event) => {
			if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
				wsRef.current.send(
					JSON.stringify({
						type: "webrtc-signaling",
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

		pcRef.current = pc
		return pc
	}, [wsRef])

	const handleSignaling = useCallback(
		async (msg: any) => {
			if (!pcRef.current) return

			try {
				if (msg.offer) {
					await pcRef.current.setRemoteDescription(
						new RTCSessionDescription(msg.offer),
					)
					const answer = await pcRef.current.createAnswer()
					await pcRef.current.setLocalDescription(answer)
					wsRef.current?.send(
						JSON.stringify({ type: "webrtc-signaling", answer }),
					)
				} else if (msg.answer) {
					await pcRef.current.setRemoteDescription(
						new RTCSessionDescription(msg.answer),
					)
				} else if (msg.candidate) {
					await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate))
				}
			} catch (err) {
				console.error("WebRTC signaling error:", err)
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

			createPeerConnection()

			stream.getVideoTracks()[0].onended = () => {
				stopSharing()
			}
		} catch (err) {
			console.error("Failed to start screen capture:", err)
			setError(err instanceof Error ? err.message : String(err))
			setIsSharing(false)
		}
	}, [wsRef, createPeerConnection, stopSharing])

	useEffect(() => {
		const ws = wsRef.current
		if (!ws) return

		const onMessage = (event: MessageEvent) => {
			try {
				const msg = JSON.parse(event.data)
				if (msg.type === "webrtc-signaling") {
					handleSignaling(msg)
				} else if (msg.type === "start-mirror" && isSharing) {
					createPeerConnection()
					const pc = pcRef.current
					if (pc) {
						pc.createOffer().then((offer) => {
							pc.setLocalDescription(offer)
							ws.send(JSON.stringify({ type: "webrtc-signaling", offer }))
						})
					}
				}
			} catch {}
		}

		ws.addEventListener("message", onMessage)
		return () => {
			ws.removeEventListener("message", onMessage)
			cleanup()
		}
	}, [wsRef, handleSignaling, isSharing, createPeerConnection, cleanup])

	return {
		isSharing,
		error,
		startSharing,
		stopSharing,
	}
}
