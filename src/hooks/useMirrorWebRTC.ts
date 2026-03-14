"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useConnection } from "../contexts/ConnectionProvider"

export function useMirrorWebRTC() {
	const { postSignal, pollSignals, sessionId } = useConnection()
	const pcRef = useRef<RTCPeerConnection | null>(null)
	const [stream, setStream] = useState<MediaStream | null>(null)
	const [mirrorStatus, setMirrorStatus] = useState<"idle" | "negotiating" | "streaming">("idle")
	const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

	const cleanup = useCallback(() => {
		if (pollIntervalRef.current) {
			clearInterval(pollIntervalRef.current)
			pollIntervalRef.current = null
		}
		if (pcRef.current) {
			pcRef.current.close()
			pcRef.current = null
		}
		setStream(null)
		setMirrorStatus("idle")
	}, [])

	const createPeerConnection = useCallback(() => {
		if (pcRef.current) pcRef.current.close()

		const pc = new RTCPeerConnection({
			iceServers: [{ urls: "stun:stun1.l.google.com:19302" }],
		})

		pc.ontrack = (e) => {
			if (e.streams?.[0]) {
				setStream(e.streams[0])
				setMirrorStatus("streaming")
			}
		}

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
			if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
				cleanup()
			}
		}

		pcRef.current = pc
		return pc
	}, [postSignal, sessionId, cleanup])

	const startPolling = useCallback(() => {
		if (pollIntervalRef.current) return

		pollIntervalRef.current = setInterval(async () => {
			const messages = await pollSignals()
			for (const msg of messages) {
				const signal = msg as any

				if (signal.type === "start-mirror" && signal.from !== sessionId) {
					setMirrorStatus("negotiating")
				}

				if (signal.type === "stop-mirror") {
					cleanup()
					continue
				}

				if (signal.type !== "webrtc-signaling" || signal.from === sessionId) continue

				if (signal.signalingType === "offer") {
					const pc = createPeerConnection()
					await pc.setRemoteDescription(signal.sdp)
					const answer = await pc.createAnswer()
					await pc.setLocalDescription(answer)

					await postSignal({
						type: "webrtc-signaling",
						signalingType: "answer",
						sdp: answer,
						from: sessionId,
					})
					setMirrorStatus("negotiating")
				} else if (signal.signalingType === "ice-candidate" && pcRef.current) {
					await pcRef.current.addIceCandidate(signal.candidate)
				}
			}
		}, 500)
	}, [pollSignals, sessionId, createPeerConnection, postSignal, cleanup])

	useEffect(() => {
		const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
		if (isMobile) {
			startPolling()
		}
		return () => cleanup()
	}, [startPolling, cleanup])

	return { stream, mirrorStatus }
}
