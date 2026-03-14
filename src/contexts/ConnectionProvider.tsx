"use client"

import type React from "react"
import {
	createContext,
	useContext,
	useEffect,
	useRef,
	useState,
	useCallback,
} from "react"

type ConnectionStatus = "connecting" | "connected" | "disconnected"

interface ConnectionContextType {
	status: ConnectionStatus
	platform: string | null
	latency: number | null
	sessionId: string
	send: (msg: unknown) => void
	subscribe: (type: string, callback: (msg: unknown) => void) => () => void
	postSignal: (payload: unknown) => Promise<void>
	pollSignals: () => Promise<unknown[]>
}

const ConnectionContext = createContext<ConnectionContextType | null>(null)

export const useConnection = () => {
	const context = useContext(ConnectionContext)
	if (!context)
		throw new Error("useConnection must be used within ConnectionProvider")
	return context
}

function generateSessionId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function ConnectionProvider({
	children,
}: { children: React.ReactNode }) {
	const [status, setStatus] = useState<ConnectionStatus>("disconnected")
	const [platform, setPlatform] = useState<string | null>(null)
	const [latency, setLatency] = useState<number | null>(null)
	const sessionIdRef = useRef(generateSessionId())
	const isMountedRef = useRef(true)
	const subscribersRef = useRef<Record<string, Set<(msg: unknown) => void>>>({})

	const subscribe = useCallback(
		(type: string, callback: (msg: unknown) => void) => {
			if (!subscribersRef.current[type]) {
				subscribersRef.current[type] = new Set()
			}
			subscribersRef.current[type].add(callback)
			return () => {
				subscribersRef.current[type].delete(callback)
			}
		},
		[],
	)

	const getAuthToken = useCallback((): string | null => {
		try {
			const urlParams = new URLSearchParams(window.location.search)
			return urlParams.get("token") || localStorage.getItem("rein_auth_token")
		} catch {
			return null
		}
	}, [])

	const send = useCallback((msg: unknown) => {
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

	const postSignal = useCallback(async (payload: unknown) => {
		await fetch("/api/signal", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				sessionId: sessionIdRef.current,
				payload,
			}),
		})
	}, [])

	const pollSignals = useCallback(async (): Promise<unknown[]> => {
		try {
			const res = await fetch(`/api/signal/${sessionIdRef.current}`)
			const data = await res.json()
			return data.messages || []
		} catch {
			return []
		}
	}, [])

	useEffect(() => {
		isMountedRef.current = true

		const token = getAuthToken()
		if (token) {
			try {
				const urlToken = new URLSearchParams(window.location.search).get("token")
				if (urlToken) localStorage.setItem("rein_auth_token", urlToken)
			} catch {}
		}

		fetch("/api/ip")
			.then((r) => r.json())
			.then(() => {
				if (isMountedRef.current) {
					setStatus("connected")
					setPlatform(null)
				}
			})
			.catch(() => {
				if (isMountedRef.current) setStatus("disconnected")
			})

		return () => {
			isMountedRef.current = false
		}
	}, [getAuthToken])

	useEffect(() => {
		if (status !== "connected") {
			setLatency(null)
			return
		}

		const measureLatency = async () => {
			const start = Date.now()
			try {
				await fetch("/api/ip")
				if (isMountedRef.current) {
					setLatency(Date.now() - start)
				}
			} catch {
				if (isMountedRef.current) setLatency(null)
			}
		}

		measureLatency()
		const interval = setInterval(measureLatency, 2000)

		return () => clearInterval(interval)
	}, [status])

	return (
		<ConnectionContext.Provider
			value={{
				status,
				platform,
				latency,
				sessionId: sessionIdRef.current,
				send,
				subscribe,
				postSignal,
				pollSignals,
			}}
		>
			{children}
		</ConnectionContext.Provider>
	)
}
