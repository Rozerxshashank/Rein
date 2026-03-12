"use client"

import type React from "react"
import { useEffect, useRef } from "react"
import { useConnection } from "../../contexts/ConnectionProvider"
import { useMirrorWebRTC } from "../../hooks/useMirrorWebRTC"

interface ScreenMirrorProps {
	scrollMode: boolean
	isTracking: boolean
	handlers: React.HTMLAttributes<HTMLDivElement>
}

const TEXTS = {
	WAITING: "Waiting for screen...",
	AUTOMATIC: "Mirroring will start automatically",
}

export const ScreenMirror = ({
	scrollMode,
	isTracking,
	handlers,
}: ScreenMirrorProps) => {
	const { wsRef, status } = useConnection()
	const videoRef = useRef<HTMLVideoElement>(null)
	const { stream, isConnecting } = useMirrorWebRTC(wsRef, status)

	useEffect(() => {
		if (videoRef.current && stream) {
			videoRef.current.srcObject = stream
		}
	}, [stream])

	const hasStream = !!stream

	return (
		<div className="absolute inset-0 flex items-center justify-center bg-black overflow-hidden select-none touch-none">
			<video
				ref={videoRef}
				autoPlay
				muted
				playsInline
				className={`w-full h-full object-contain transition-opacity duration-500 ${
					hasStream ? "opacity-100" : "opacity-0"
				}`}
			/>

			{!hasStream && (
				<div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 gap-4">
					<div className="loading loading-spinner loading-lg text-primary" />
					<div className="text-center px-6">
						<p className="font-semibold text-lg">{TEXTS.WAITING}</p>
						<p className="text-sm opacity-60">
							{isConnecting ? "Negotiating connection..." : TEXTS.AUTOMATIC}
						</p>
					</div>
				</div>
			)}

			<div
				className="absolute inset-0 z-10"
				{...handlers}
				style={{
					cursor: scrollMode ? "ns-resize" : isTracking ? "none" : "default",
				}}
			/>
		</div>
	)
}
