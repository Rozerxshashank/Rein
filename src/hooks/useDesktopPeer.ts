"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useConnection } from "../contexts/ConnectionProvider"

/**
 * useDesktopPeer — Runs on the Desktop (Electron renderer).
 *
 * Unified WebRTC "server" peer that:
 *   1. Subscribes to SSE signaling (offers, ICE candidates) from mobile clients
 *   2. Creates an RTCPeerConnection and answers the offer
 *   3. Listens for incoming DataChannels (DC_UNORDERED and DC_ORDERED)
 *   4. Forwards received input messages to /api/input on localhost
 *   5. Captures the screen via getDisplayMedia() and adds the media track
 *      with codec preferences (H.264 > VP9 > AV1) and adaptive bitrate
 */
export function useDesktopPeer() {
	const { postSignal, sessionId } = useConnection()
	const pcRef = useRef<RTCPeerConnection | null>(null)
	const streamRef = useRef<MediaStream | null>(null)
	const sseRef = useRef<EventSource | null>(null)
	const [isSharing, setIsSharing] = useState(false)
	const [peerConnected, setPeerConnected] = useState(false)
	const isMountedRef = useRef(true)

	const getAuthToken = useCallback((): string | null => {
		try {
			return localStorage.getItem("rein_auth_token") || null
		} catch {
			return null
		}
	}, [])

	/** Forward a DataChannel input message to the local HTTP server. */
	const forwardInput = useCallback((msg: unknown) => {
		const token = getAuthToken()
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		}
		if (token) headers.Authorization = `Bearer ${token}`

		fetch("/api/input", {
			method: "POST",
			headers,
			body: JSON.stringify(msg),
		}).catch(() => {})
	}, [getAuthToken])

	const cleanup = useCallback(() => {
		if (sseRef.current) {
			sseRef.current.close()
			sseRef.current = null
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
		setPeerConnected(false)
	}, [])

	/** Configure codec preferences (H.264 > VP9 > AV1) and adaptive bitrate on a video sender. */
	const configureMediaSender = useCallback((pc: RTCPeerConnection, sender: RTCRtpSender) => {
		// Set adaptive bitrate
		try {
			const params = sender.getParameters()
			if (!params.encodings || params.encodings.length === 0) {
				params.encodings = [{}]
			}
			params.encodings[0].maxBitrate = 5_000_000 // 5 Mbps cap
			params.encodings[0].scaleResolutionDownBy = 1.0
			sender.setParameters(params).catch(() => {})
		} catch {
			// Some browsers may not support this
		}

		// Set codec preferences: H.264 > VP9 > AV1
		try {
			const transceiver = pc.getTransceivers().find(t => t.sender === sender)
			if (transceiver && typeof transceiver.setCodecPreferences === "function") {
				const capabilities = RTCRtpReceiver.getCapabilities?.("video")
				if (capabilities) {
					const codecs = capabilities.codecs
					const h264 = codecs.filter(c => c.mimeType === "video/H264")
					const vp9 = codecs.filter(c => c.mimeType === "video/VP9")
					const av1 = codecs.filter(c => c.mimeType === "video/AV1")
					const rest = codecs.filter(c =>
						c.mimeType !== "video/H264" &&
						c.mimeType !== "video/VP9" &&
						c.mimeType !== "video/AV1"
					)
					const preferred = [...h264, ...vp9, ...av1, ...rest]
					if (preferred.length > 0) {
						transceiver.setCodecPreferences(preferred)
					}
				}
			}
		} catch {
			// Codec preference API may not be available
		}
	}, [])

	/** Create the RTCPeerConnection that will receive DataChannels and send media. */
	const createPeerConnection = useCallback(() => {
		if (pcRef.current) pcRef.current.close()

		const pc = new RTCPeerConnection({
			iceServers: [{ urls: "stun:stun1.l.google.com:19302" }],
		})

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

		pc.ondatachannel = (e) => {
			const dc = e.channel
			console.log(`[DesktopPeer] DataChannel received: "${dc.label}" (ordered=${dc.ordered})`)

			dc.onmessage = (event) => {
				try {
					const msg = JSON.parse(event.data)
					forwardInput(msg)
				} catch {
					console.warn("[DesktopPeer] Failed to parse DataChannel message")
				}
			}

			dc.onopen = () => {
				console.log(`[DesktopPeer] DataChannel "${dc.label}" opened`)
			}

			dc.onclose = () => {
				console.log(`[DesktopPeer] DataChannel "${dc.label}" closed`)
			}
		}

		pc.onconnectionstatechange = () => {
			console.log(`[DesktopPeer] Connection state: ${pc.connectionState}`)
			if (pc.connectionState === "connected") {
				setPeerConnected(true)
			} else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
				setPeerConnected(false)
			}
		}

		pcRef.current = pc
		return pc
	}, [postSignal, sessionId, forwardInput])

	/** Start screen sharing and add the media track to the peer connection. */
	const startSharing = useCallback(async () => {
		if (!navigator.mediaDevices?.getDisplayMedia) return

		try {
			const stream = await navigator.mediaDevices.getDisplayMedia({
				video: true,
				audio: true,
			})
			streamRef.current = stream

			const pc = pcRef.current
			if (pc) {
				for (const track of stream.getTracks()) {
					const sender = pc.addTrack(track, stream)
					configureMediaSender(pc, sender)
				}
			}

			stream.getTracks()[0].onended = () => {
				if (streamRef.current) {
					for (const track of streamRef.current.getTracks()) track.stop()
					streamRef.current = null
				}
				setIsSharing(false)
				postSignal({
					type: "stop-mirror",
					from: sessionId,
				})
			}

			setIsSharing(true)

			postSignal({
				type: "start-mirror",
				from: sessionId,
			})

			// If there's already a remote description, renegotiate to include the new track
			if (pc && pc.remoteDescription) {
				const offer = await pc.createOffer()
				await pc.setLocalDescription(offer)
				await postSignal({
					type: "webrtc-signaling",
					signalingType: "offer",
					sdp: offer,
					from: sessionId,
				})
			}
		} catch {
			console.warn("[DesktopPeer] Failed to start screen sharing")
		}
	}, [postSignal, sessionId, configureMediaSender])

	const stopSharing = useCallback(() => {
		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) track.stop()
			streamRef.current = null
		}
		setIsSharing(false)
		postSignal({
			type: "stop-mirror",
			from: sessionId,
		})
	}, [postSignal, sessionId])

	/** Subscribe to SSE for signaling messages and handle offers/ICE candidates from mobile clients. */
	const startSSE = useCallback(() => {
		if (sseRef.current) {
			sseRef.current.close()
			sseRef.current = null
		}

		const sseUrl = `/api/signal/ice?sessionId=${encodeURIComponent(sessionId)}`
		const sse = new EventSource(sseUrl)
		sseRef.current = sse

		sse.onmessage = async (event) => {
			if (!isMountedRef.current) return

			try {
				const signal = JSON.parse(event.data)
				if (signal.type !== "webrtc-signaling" || signal.from === sessionId) return

				if (signal.signalingType === "offer") {
					const pc = createPeerConnection()

					// Add existing media tracks if we're already sharing
					if (streamRef.current) {
						for (const track of streamRef.current.getTracks()) {
							const sender = pc.addTrack(track, streamRef.current)
							configureMediaSender(pc, sender)
						}
					}

					await pc.setRemoteDescription(signal.sdp)
					const answer = await pc.createAnswer()
					await pc.setLocalDescription(answer)

					await postSignal({
						type: "webrtc-signaling",
						signalingType: "answer",
						sdp: answer,
						from: sessionId,
					})
				} else if (signal.signalingType === "answer" && pcRef.current) {
					if (pcRef.current.signalingState === "have-local-offer") {
						await pcRef.current.setRemoteDescription(signal.sdp)
					}
				} else if (signal.signalingType === "ice-candidate" && pcRef.current) {
					try {
						await pcRef.current.addIceCandidate(signal.candidate)
					} catch {
						// Ignore ICE candidate errors for candidates arriving before remote desc
					}
				}
			} catch {
				// Ignore parse errors
			}
		}

		sse.onerror = () => {
			console.warn("[DesktopPeer SSE] Connection error, EventSource will auto-reconnect")
		}
	}, [sessionId, createPeerConnection, postSignal, configureMediaSender])

	useEffect(() => {
		isMountedRef.current = true

		// Only run on desktop (non-mobile)
		const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
		if (!isMobile) {
			startSSE()
		}

		return () => {
			isMountedRef.current = false
			cleanup()
		}
	}, [startSSE, cleanup])

	return { startSharing, stopSharing, isSharing, peerConnected }
}
