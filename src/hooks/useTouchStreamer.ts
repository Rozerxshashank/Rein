"use client"

import type React from "react"
import { useCallback } from "react"
import { useConnection } from "../contexts/ConnectionProvider"

export interface TouchContact {
	id: number
	x: number
	y: number
	type: "start" | "move" | "end"
}

export function useTouchStreamer() {
	const { send } = useConnection()

	const streamTouches = useCallback(
		(e: React.TouchEvent, type: "start" | "move" | "end") => {
			const target = e.currentTarget as HTMLElement
			const rect = target.getBoundingClientRect()

			const contacts: TouchContact[] = []

			for (let i = 0; i < e.changedTouches.length; i++) {
				const t = e.changedTouches[i]
				const x = (t.clientX - rect.left) / rect.width
				const y = (t.clientY - rect.top) / rect.height
				contacts.push({
					id: t.identifier,
					x: Math.max(0, Math.min(1, x)),
					y: Math.max(0, Math.min(1, y)),
					type,
				})
			}

			send({ type: "touch", contacts })
		},
		[send],
	)

	return {
		onTouchStart: (e: React.TouchEvent) => streamTouches(e, "start"),
		onTouchMove: (e: React.TouchEvent) => streamTouches(e, "move"),
		onTouchEnd: (e: React.TouchEvent) => streamTouches(e, "end"),
		onTouchCancel: (e: React.TouchEvent) => streamTouches(e, "end"),
	}
}
