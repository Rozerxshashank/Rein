import type React from "react"
import { useRef } from "react"
import { useCaptureProvider } from "../../hooks/useCaptureProvider"
import { useMirrorStream } from "../../hooks/useMirrorStream"

interface ScreenMirrorProps {
	scrollMode: boolean
	isTracking: boolean
	handlers: {
		onTouchStart: (e: React.TouchEvent) => void
		onTouchMove: (e: React.TouchEvent) => void
		onTouchEnd: (e: React.TouchEvent) => void
	}
	status: "connecting" | "connected" | "disconnected"
	wsRef: React.RefObject<WebSocket | null>
}

export const ScreenMirror: React.FC<ScreenMirrorProps> = ({
	scrollMode,
	isTracking,
	handlers,
	status,
	wsRef,
}) => {
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const { hasFrame } = useMirrorStream(wsRef, canvasRef, status)
	const { isSharing, startSharing, stopSharing } = useCaptureProvider(
		wsRef,
		status,
	)

	// Only show sharing controls if the browser supports it (PC)
	const canShare =
		typeof navigator !== "undefined" &&
		!!navigator.mediaDevices?.getDisplayMedia

	const handleStart = (e: React.TouchEvent) => {
		handlers.onTouchStart(e)
	}

	const handlePreventFocus = (e: React.MouseEvent) => {
		e.preventDefault()
	}

	return (
		<div
			className="flex-1 bg-neutral-900 relative touch-none select-none flex items-center justify-center overflow-hidden"
			onTouchStart={handleStart}
			onTouchMove={handlers.onTouchMove}
			onTouchEnd={handlers.onTouchEnd}
			onMouseDown={handlePreventFocus}
		>
			{/* Status indicator bar */}
			<div
				className={`absolute top-0 left-0 w-full h-1 z-20 ${
					status === "connected" ? "bg-success" : "bg-error"
				}`}
			/>

			{/* Mirror canvas */}
			<canvas
				ref={canvasRef}
				className="absolute w-full h-full object-contain pointer-events-none"
				style={{ imageRendering: "auto" }}
			/>

			{/* Overlay when no frame yet */}
			{!hasFrame && !isSharing && (
				<div className="absolute inset-0 flex flex-col items-center justify-center z-40 bg-neutral-900/40 backdrop-blur-[2px] pointer-events-none px-6">
					<div className="text-neutral-500 text-center pointer-events-none">
						<div className="text-2xl mb-4 opacity-40">
							{status === "connected" ? "Mirror Standby" : "Connecting..."}
						</div>

						{status === "connected" && canShare && (
							<div className="flex flex-col items-center gap-4 animate-in fade-in zoom-in duration-300 pointer-events-auto">
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation()
										startSharing()
									}}
									className="btn btn-primary btn-wide shadow-xl relative z-50"
								>
									Start Screen Share
								</button>
								<p className="text-[10px] text-neutral-500 max-w-[200px]">
									Tip: Select <b>"Entire Screen"</b> to mirror other apps.
								</p>
							</div>
						)}

						{status === "connected" && !canShare && (
							<div className="bg-primary/10 text-primary text-xs p-4 rounded-2xl border border-primary/20 mb-6 max-w-xs mx-auto animate-in fade-in slide-in-from-bottom-2 duration-700 backdrop-blur-sm pointer-events-auto">
								Waiting for Desktop stream...
							</div>
						)}

						{!canShare && (
							<div className="loading loading-ring loading-lg opacity-20 mt-4" />
						)}
					</div>
				</div>
			)}

			{/* Sharing state overlay */}
			{isSharing && (
				<div className="absolute top-4 left-4 z-30 flex items-center gap-2">
					<div className="badge badge-error gap-2 p-3">
						<span className="w-2 h-2 rounded-full bg-white animate-pulse" />
						LIVE SHARING
					</div>
					<button
						type="button"
						onClick={stopSharing}
						className="btn btn-xs btn-outline btn-error bg-black/40 backdrop-blur-sm"
					>
						Stop
					</button>
				</div>
			)}

			{/* Scroll mode badge */}
			{scrollMode && (
				<div className="absolute top-4 right-4 badge badge-info z-10">
					SCROLL Active
				</div>
			)}

			{/* Tracking indicator */}
			{isTracking && hasFrame && (
				<div className="absolute bottom-4 right-4 z-10">
					<div className="loading loading-ring loading-sm text-primary" />
				</div>
			)}
		</div>
	)
}
