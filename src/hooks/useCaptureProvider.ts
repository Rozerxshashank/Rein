import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hook to handle screen capture from the browser and send to a WebSocket.
 * Implements persistent canvas, 480p downscaling, and Congestion Control.
 */
export function useCaptureProvider(
	wsRef: React.RefObject<WebSocket | null>,
	status: "connecting" | "connected" | "disconnected",
) {
	const [isSharing, setIsSharing] = useState(false);
	const isSharingRef = useRef(false);
	const streamRef = useRef<MediaStream | null>(null);
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const workerRef = useRef<Worker | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const isMounted = useRef(true);
	const isBusy = useRef(false);

	// Initial worker setup
	useEffect(() => {
		isMounted.current = true;

		const workerCode = `
            let timer = null;
            self.onmessage = (e) => {
                if (e.data === 'start') {
                    if (timer) clearInterval(timer);
                    timer = setInterval(() => self.postMessage('tick'), 33);
                } else if (e.data === 'stop') {
                    if (timer) clearInterval(timer);
                    timer = null;
                }
            };
        `;
		const blob = new Blob([workerCode], { type: "application/javascript" });
		const url = URL.createObjectURL(blob);
		workerRef.current = new Worker(url);
		URL.revokeObjectURL(url); // Clean up immediately after construction

		workerRef.current.onmessage = () => {
			if (isSharingRef.current) {
				captureFrame();
			}
		};

		return () => {
			isMounted.current = false;
			stopSharing();
			if (workerRef.current) {
				workerRef.current.terminate();
				workerRef.current = null;
			}
		};
	}, []);

	// Diagnostics/Re-registration
	useEffect(() => {
		if (status === "connected" && isSharingRef.current && wsRef.current) {
			wsRef.current.send(JSON.stringify({ type: "start-provider" }));
		}
	}, [status, wsRef]);

	const captureFrame = useCallback(() => {
		const video = videoRef.current;
		const ws = wsRef.current;
		if (
			!isSharingRef.current ||
			!streamRef.current ||
			!ws ||
			isBusy.current ||
			!video
		)
			return;
		if (ws.readyState !== WebSocket.OPEN) return;

		// CONGESTION CONTROL: If buffer is too high, skip frame to prevent buildup
		// 256KB is roughly 8-10 frames of 480p/0.3 quality JPG data.
		if (ws.bufferedAmount > 256 * 1024) {
			return;
		}

		if (video.paused || video.ended || video.readyState < 2) {
			return;
		}

		// Initialize or reuse persistent canvas
		if (!canvasRef.current) {
			canvasRef.current = document.createElement("canvas");
		}
		const canvas = canvasRef.current;
		const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
		if (!ctx) return;

		// 480p (854px width)
		const targetWidth = 854;
		if (canvas.width !== targetWidth) {
			const scale = targetWidth / video.videoWidth;
			canvas.width = targetWidth;
			canvas.height = Math.floor(video.videoHeight * scale);
			ctx.imageSmoothingEnabled = true;
		}

		isBusy.current = true;
		try {
			ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

			canvas.toBlob(
				(blob) => {
					isBusy.current = false;
					if (
						!isSharingRef.current ||
						!wsRef.current ||
						wsRef.current.readyState !== WebSocket.OPEN
					)
						return;

					if (blob) {
						wsRef.current.send(blob);
					}
				},
				"image/jpeg",
				0.3,
			);
		} catch (err) {
			isBusy.current = false;
		}
	}, [wsRef]);

	const startSharing = async () => {
		try {
			const stream = await navigator.mediaDevices.getDisplayMedia({
				video: {
					frameRate: { ideal: 30 },
					width: { ideal: 1280 },
				},
				audio: false,
			});

			streamRef.current = stream;

			const video = document.createElement("video");
			video.muted = true;
			video.playsInline = true;
			video.srcObject = stream;
			videoRef.current = video;

			await video.play();

			if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
				wsRef.current.send(JSON.stringify({ type: "start-provider" }));
			}

			stream.getVideoTracks()[0].onended = () => {
				stopSharing();
			};

			isSharingRef.current = true;
			setIsSharing(true);

			if (workerRef.current) {
				workerRef.current.postMessage("start");
			}
		} catch (err) {
			console.error("Failed to start screen share:", err);
		}
	};

	const stopSharing = useCallback(() => {
		if (workerRef.current) {
			workerRef.current.postMessage("stop");
		}
		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) {
				track.stop();
				track.onended = null;
			}
			streamRef.current = null;
		}
		if (videoRef.current) {
			videoRef.current.pause();
			videoRef.current.srcObject = null;
			videoRef.current = null;
		}
		isSharingRef.current = false;
		setIsSharing(false);
		isBusy.current = false;

		if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: "stop-mirror" }));
		}
	}, [wsRef]);

	return {
		isSharing,
		startSharing,
		stopSharing,
	};
}
