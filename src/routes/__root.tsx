import {
	HeadContent,
	Link,
	Outlet,
	Scripts,
	createRootRoute,
} from "@tanstack/react-router"
import { useEffect, useRef } from "react"
import { APP_CONFIG, THEMES } from "../config"
import "../styles.css"
import {
	ConnectionProvider,
	useConnection,
} from "../contexts/ConnectionProvider"
import { useCaptureProvider } from "../hooks/useCaptureProvider"

export const Route = createRootRoute({
	component: AppWithConnection,
	errorComponent: (props) => {
		return (
			<RootDocument>
				<div>Error: {props.error.message}</div>
			</RootDocument>
		)
	},
	notFoundComponent: () => <div>Not Found</div>,
})

function AppWithConnection() {
	return (
		<ConnectionProvider>
			<RootComponent />
		</ConnectionProvider>
	)
}

function RootComponent() {
	return (
		<RootDocument>
			<DesktopCaptureProvider />
			<Outlet />
			{/* <TanStackRouterDevtools position="bottom-right" /> */}
		</RootDocument>
	)
}

function DesktopCaptureProvider() {
	const { wsRef, status } = useConnection()
	const { startSharing, isSharing, error } = useCaptureProvider(wsRef)
	const hasStartedRef = useRef(false)

	useEffect(() => {
		// Attempt auto-start, but many browsers (like Firefox on Linux)
		// will block this unless it's triggered by a user click.
		if (status !== "connected" || hasStartedRef.current) return

		const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
		const canShare = !!navigator.mediaDevices?.getDisplayMedia

		if (!isMobile && canShare) {
			hasStartedRef.current = true
			startSharing().catch(() => {
				// Auto-start failed, user will need to click the button
				hasStartedRef.current = false
			})
		}
	}, [status, startSharing])

	const isMobile =
		typeof navigator !== "undefined" &&
		/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
	if (isMobile) return null

	return (
		<div className="fixed top-14 right-4 z-[60] flex flex-col items-end gap-2">
			{!isSharing && (
				<button
					type="button"
					onClick={() => startSharing()}
					className={`btn btn-sm ${error ? "btn-error" : "btn-primary"} shadow-lg animate-pulse`}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						className="h-4 w-4 mr-1"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<title>Mirror</title>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
						/>
					</svg>
					{error ? "Retry Screen Mirror" : "Start Screen Mirror"}
				</button>
			)}
			{error && (
				<div className="alert alert-error py-1 px-3 text-[10px] w-auto shadow-md">
					<span>{error}</span>
				</div>
			)}
			{isSharing && (
				<div className="badge badge-success badge-sm gap-1 py-2 px-3 shadow-md">
					<div className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
					Mirroring Active
				</div>
			)}
		</div>
	)
}

function ThemeInit() {
	useEffect(() => {
		if (typeof localStorage === "undefined") return
		const saved = localStorage.getItem(APP_CONFIG.THEME_STORAGE_KEY)
		const theme =
			saved === THEMES.LIGHT || saved === THEMES.DARK ? saved : THEMES.DEFAULT
		document.documentElement.setAttribute("data-theme", theme)
	}, [])
	return null
}

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
				<meta charSet="utf-8" />
				<meta
					name="viewport"
					content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0, interactive-widget=resizes-content"
				/>
				<title>Rein Remote</title>
				<link rel="icon" type="image/svg+xml" href="/app_icon/Icon.svg" />
				<link rel="manifest" href="/manifest.json" />
			</head>
			<body className="bg-base-200 text-base-content overflow-hidden overscroll-none">
				<ThemeInit />
				<div className="flex flex-col h-[100dvh]">
					<Navbar />
					<main className="flex-1 overflow-hidden relative">{children}</main>
				</div>
				<Scripts />
			</body>
		</html>
	)
}

function LatencyBadge() {
	const { latency } = useConnection()
	if (latency === null) return null

	const color =
		latency < 50
			? "text-green-400"
			: latency < 150
				? "text-yellow-400"
				: "text-red-400"

	return (
		<div className={`flex items-center gap-1.5 px-2 ${color}`}>
			<div className="w-1.5 h-1.5 rounded-full bg-current shadow-[0_0_8px_rgba(0,0,0,0.3)]" />
			<span className="text-[11px] font-mono font-medium whitespace-nowrap">
				{latency}ms
			</span>
		</div>
	)
}

function Navbar() {
	return (
		<div className="navbar bg-base-100 border-b border-base-300 min-h-12 h-12 z-50 px-4">
			<div className="flex-1">
				<Link to="/trackpad" className="btn btn-ghost text-xl normal-case">
					<img
						src="/app_icon/IconLine.png"
						height={32}
						width={32}
						alt="Rein logo"
					/>
					Rein
				</Link>
			</div>
			<div className="flex-none flex items-center gap-2">
				<LatencyBadge />
				<Link
					to="/trackpad"
					className="btn btn-ghost btn-sm"
					activeProps={{ className: "btn-active bg-base-200" }}
				>
					Trackpad
				</Link>
				<Link
					to="/settings"
					className="btn btn-ghost btn-sm"
					activeProps={{ className: "btn-active bg-base-200" }}
				>
					Settings
				</Link>
			</div>
		</div>
	)
}
