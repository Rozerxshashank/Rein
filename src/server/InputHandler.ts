import { getDriver } from "./NativeDriver"
import { KEY_MAP, MODIFIER } from "./KeyMap"

export interface InputMessage {
	type:
		| "move"
		| "paste"
		| "copy"
		| "click"
		| "scroll"
		| "key"
		| "text"
		| "zoom"
		| "combo"
	dx?: number
	dy?: number
	button?: "left" | "right" | "middle"
	press?: boolean
	key?: string
	keys?: string[]
	text?: string
	delta?: number
}

export class InputHandler {
	private lastMoveTime = 0
	private lastScrollTime = 0
	private pendingMove: InputMessage | null = null
	private pendingScroll: InputMessage | null = null
	private moveTimer: ReturnType<typeof setTimeout> | null = null
	private scrollTimer: ReturnType<typeof setTimeout> | null = null
	private throttleMs: number

	constructor(throttleMs = 8) {
		this.throttleMs = throttleMs
	}

	setThrottleMs(ms: number) {
		this.throttleMs = ms
	}

	private isFiniteNumber(value: unknown): value is number {
		return typeof value === "number" && Number.isFinite(value)
	}

	private clamp(value: number, min: number, max: number): number {
		return Math.max(min, Math.min(max, value))
	}

	async handleMessage(msg: InputMessage) {
		if (msg.text && typeof msg.text === "string" && msg.text.length > 500) {
			msg.text = msg.text.substring(0, 500)
		}

		const MAX_COORD = 2000
		if (this.isFiniteNumber(msg.dx)) {
			msg.dx = this.clamp(msg.dx, -MAX_COORD, MAX_COORD)
		} else {
			msg.dx = 0
		}
		if (this.isFiniteNumber(msg.dy)) {
			msg.dy = this.clamp(msg.dy, -MAX_COORD, MAX_COORD)
		} else {
			msg.dy = 0
		}
		if (this.isFiniteNumber(msg.delta)) {
			msg.delta = this.clamp(msg.delta, -MAX_COORD, MAX_COORD)
		} else {
			msg.delta = 0
		}

		if (msg.type === "move") {
			const now = Date.now()
			if (now - this.lastMoveTime < this.throttleMs) {
				this.pendingMove = msg
				if (!this.moveTimer) {
					this.moveTimer = setTimeout(() => {
						this.moveTimer = null
						if (this.pendingMove) {
							const pending = this.pendingMove
							this.pendingMove = null
							this.handleMessage(pending).catch((err) => {
								console.error("Error processing pending move event:", err)
							})
						}
					}, this.throttleMs)
				}
				return
			}
			this.lastMoveTime = now
		} else if (msg.type === "scroll") {
			const now = Date.now()
			if (now - this.lastScrollTime < this.throttleMs) {
				this.pendingScroll = msg
				if (!this.scrollTimer) {
					this.scrollTimer = setTimeout(() => {
						this.scrollTimer = null
						if (this.pendingScroll) {
							const pending = this.pendingScroll
							this.pendingScroll = null
							this.handleMessage(pending).catch((err) => {
								console.error("Error processing pending scroll event:", err)
							})
						}
					}, this.throttleMs)
				}
				return
			}
			this.lastScrollTime = now
		}

		switch (msg.type) {
			case "move":
				getDriver().moveMouse(msg.dx || 0, msg.dy || 0)
				break

			case "click":
				if (msg.button) {
					getDriver().click(msg.button, !!msg.press)
				}
				break

			case "copy":
				getDriver().keyToggle(MODIFIER, true)
				getDriver().keyTap(KEY_MAP.c || 0)
				getDriver().keyToggle(MODIFIER, false)
				break

			case "paste":
				getDriver().keyToggle(MODIFIER, true)
				getDriver().keyTap(KEY_MAP.v || 0)
				getDriver().keyToggle(MODIFIER, false)
				break

			case "scroll":
				getDriver().scroll(-(msg.dx || 0), -(msg.dy || 0))
				break

			case "zoom":
				if (msg.delta && msg.delta !== 0) {
				const amount = Math.sign(msg.delta) * 1.0
				getDriver().keyToggle(MODIFIER, true)
				getDriver().scroll(0, amount)
				getDriver().keyToggle(MODIFIER, false)
				}
				break

			case "key":
				if (msg.key) {
					const code = KEY_MAP[msg.key.toLowerCase()]
					if (code !== undefined) {
						getDriver().keyTap(code)
					} else if (msg.key.length === 1) {
						getDriver().typeText(msg.key)
					}
				}
				break

			case "combo":
				if (msg.keys && Array.isArray(msg.keys)) {
					const codes = msg.keys
						.map((k) => KEY_MAP[k.toLowerCase()])
						.filter((c) => c !== undefined)
					for (const c of codes) getDriver().keyToggle(c, true)
					for (const c of [...codes].reverse()) getDriver().keyToggle(c, false)
				}
				break

			case "text":
				if (msg.text) {
					getDriver().typeText(msg.text)
				}
				break
		}
	}
}
