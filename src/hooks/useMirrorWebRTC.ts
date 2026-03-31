"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useConnection } from "../contexts/ConnectionProvider"

/**
 * useMirrorWebRTC — Runs on the Phone (Client).
 *
 * This hook now receives the screen mirror stream from the UNIFIED
 * RTCPeerConnection managed by ConnectionProvider. It subscribes to
 * "mirror-stream" events instead of creating its own peer connection.
 *
 * The desktop peer adds a media track to the shared P2P connection,
 * and ConnectionProvider's `pc.ontrack` fires, which broadcasts the
 * stream to all "mirror-stream" subscribers.
 */
export function useMirrorWebRTC() {
	const { subscribe } = useConnection()
	const [stream, setStream] = useState<MediaStream | null>(null)
	const [mirrorStatus, setMirrorStatus] = useState<"idle" | "negotiating" | "streaming">("idle")
	const isMountedRef = useRef(true)

	const handleStream = useCallback((s: unknown) => {
		if (!isMountedRef.current) return
		if (s instanceof MediaStream) {
			setStream(s)
			setMirrorStatus("streaming")
		} else {
			setStream(null)
			setMirrorStatus("idle")
		}
	}, [])

	const handleStatus = useCallback((s: unknown) => {
		if (!isMountedRef.current) return
		if (s === "negotiating") {
			setMirrorStatus("negotiating")
		} else if (s === "idle") {
			setMirrorStatus("idle")
			setStream(null)
		}
	}, [])

	useEffect(() => {
		isMountedRef.current = true

		const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
		if (!isMobile) {
			return () => { isMountedRef.current = false }
		}

		const unsubStream = subscribe("mirror-stream", handleStream)
		const unsubStatus = subscribe("mirror-status", handleStatus)

		return () => {
			isMountedRef.current = false
			unsubStream()
			unsubStatus()
		}
	}, [subscribe, handleStream, handleStatus])

	return { stream, mirrorStatus }
}
