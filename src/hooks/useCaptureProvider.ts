"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useConnection } from "../contexts/ConnectionProvider"

export function useCaptureProvider() {
	const { postSignal, pollSignals, sessionId } = useConnection()
	const pcRef = useRef<RTCPeerConnection | null>(null)
	const streamRef = useRef<MediaStream | null>(null)
	const [isSharing, setIsSharing] = useState(false)
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
		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) track.stop()
			streamRef.current = null
		}
		setIsSharing(false)
	}, [])

	const startSharing = useCallback(async () => {
		cleanup()

		try {
			const stream = await navigator.mediaDevices.getDisplayMedia({
				video: true,
				audio: false,
			})
			streamRef.current = stream

			const pc = new RTCPeerConnection({
				iceServers: [{ urls: "stun:stun1.l.google.com:19302" }],
			})
			pcRef.current = pc

			for (const track of stream.getTracks()) {
				pc.addTrack(track, stream)
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

			stream.getTracks()[0].onended = () => {
				cleanup()
				postSignal({
					type: "stop-mirror",
					from: sessionId,
				})
			}

			const offer = await pc.createOffer()
			await pc.setLocalDescription(offer)

			await postSignal({
				type: "webrtc-signaling",
				signalingType: "offer",
				sdp: offer,
				from: sessionId,
			})

			pollIntervalRef.current = setInterval(async () => {
				const messages = await pollSignals()
				for (const msg of messages) {
					const signal = msg as any
					if (signal.type !== "webrtc-signaling" || signal.from === sessionId) continue

					if (signal.signalingType === "answer" && pcRef.current) {
						if (pcRef.current.signalingState === "have-local-offer") {
							await pcRef.current.setRemoteDescription(signal.sdp)
						}
					} else if (signal.signalingType === "ice-candidate" && pcRef.current) {
						await pcRef.current.addIceCandidate(signal.candidate)
					}
				}
			}, 500)

			setIsSharing(true)

			await postSignal({
				type: "start-mirror",
				from: sessionId,
			})
		} catch {
			cleanup()
		}
	}, [cleanup, postSignal, pollSignals, sessionId])

	const stopSharing = useCallback(() => {
		cleanup()
		postSignal({
			type: "stop-mirror",
			from: sessionId,
		})
	}, [cleanup, postSignal, sessionId])

	useEffect(() => {
		return () => cleanup()
	}, [cleanup])

	return { startSharing, stopSharing, isSharing }
}
