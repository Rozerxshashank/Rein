"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export function useCaptureProvider(wsRef: React.RefObject<WebSocket | null>) {
	const [isSharing, setIsSharing] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const videoRef = useRef<HTMLVideoElement | null>(null)
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const streamRef = useRef<MediaStream | null>(null)
	const workerRef = useRef<Worker | null>(null)

	const stopSharing = useCallback(() => {
		// Stop the worker timer
		if (workerRef.current) {
			workerRef.current.postMessage({ type: "stop" })
			workerRef.current.terminate()
			workerRef.current = null
		}
		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) track.stop()
			streamRef.current = null
		}
		if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: "stop-mirror" }))
		}
		setIsSharing(false)
	}, [wsRef])

	const captureFrame = useCallback(() => {
		if (!videoRef.current || !canvasRef.current || !wsRef.current) return
		if (wsRef.current.readyState !== WebSocket.OPEN) return

		// Backpressure: Skip frame if buffer is filling up (> 1MB)
		if (wsRef.current.bufferedAmount > 1024 * 1024) return

		const video = videoRef.current
		const canvas = canvasRef.current
		const ctx = canvas.getContext("2d", { alpha: false })
		if (!ctx) return

		// Cap resolution to 720p
		const MAX_DIM = 1280
		let width = video.videoWidth
		let height = video.videoHeight

		if (width > MAX_DIM || height > MAX_DIM) {
			const ratio = Math.min(MAX_DIM / width, MAX_DIM / height)
			width = Math.floor(width * ratio)
			height = Math.floor(height * ratio)
		}

		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width
			canvas.height = height
		}

		ctx.drawImage(video, 0, 0, width, height)

		const format = "image/webp"
		const quality = 1

		canvas.toBlob(
			(blob) => {
				if (blob && wsRef.current?.readyState === WebSocket.OPEN) {
					wsRef.current.send(blob)
				}
			},
			format,
			quality,
		)
	}, [wsRef])

	const startSharing = useCallback(async () => {
		setError(null)
		try {
			const stream = await navigator.mediaDevices.getDisplayMedia({
				video: {
					displaySurface: "monitor",
				},
			})

			// Create hidden video to consume the stream
			if (!videoRef.current) {
				videoRef.current = document.createElement("video")
				videoRef.current.muted = true
				videoRef.current.playsInline = true
			}

			// Create hidden canvas for capturing frames
			if (!canvasRef.current) {
				canvasRef.current = document.createElement("canvas")
			}

			const video = videoRef.current
			video.srcObject = stream
			await video.play()

			streamRef.current = stream
			setIsSharing(true)

			if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
				wsRef.current.send(JSON.stringify({ type: "start-provider" }))
			}

			// Use a Web Worker timer instead of setInterval.
			// Worker timers are NOT throttled by the browser when the tab
			// is in the background, solving the tab-switching latency issue.
			const worker = new Worker("/capture-timer-worker.js")
			workerRef.current = worker
			worker.onmessage = () => {
				captureFrame()
			}
			worker.postMessage({ type: "start", interval: 80 })

			// Handle stream termination (e.g. user clicks "Stop Sharing")
			stream.getVideoTracks()[0].onended = () => {
				stopSharing()
			}
		} catch (err) {
			console.error("Failed to start screen capture:", err)
			setError(err instanceof Error ? err.message : String(err))
			setIsSharing(false)
		}
	}, [wsRef, captureFrame, stopSharing])

	useEffect(() => {
		return () => {
			if (workerRef.current) {
				workerRef.current.postMessage({ type: "stop" })
				workerRef.current.terminate()
			}
			if (streamRef.current) {
				for (const track of streamRef.current.getTracks()) track.stop()
			}
		}
	}, [])

	return {
		isSharing,
		error,
		startSharing,
		stopSharing,
	}
}
