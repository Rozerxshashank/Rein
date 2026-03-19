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
		| "touch"
	dx?: number
	dy?: number
	button?: "left" | "right" | "middle"
	press?: boolean
	key?: string
	keys?: string[]
	text?: string
	delta?: number
	contacts?: Array<{ id: number; x: number; y: number; type: "start" | "move" | "end" }>
}

export class InputHandler {
	private lastMoveTime = 0
	private lastScrollTime = 0
	private pendingMove: InputMessage | null = null
	private pendingScroll: InputMessage | null = null
	private moveTimer: ReturnType<typeof setTimeout> | null = null
	private scrollTimer: ReturnType<typeof setTimeout> | null = null
	private throttleMs: number

	private activeContacts = new Map<number, { x: number; y: number }>()
	private touchStartTime = 0
	private touchMoved = false
	private touchFingerCount = 0
	private lastPinchDist: number | null = null

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

	private getTouchDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
		const dx = a.x - b.x
		const dy = a.y - b.y
		return Math.sqrt(dx * dx + dy * dy)
	}

	private handleTouchContacts(contacts: Array<{ id: number; x: number; y: number; type: "start" | "move" | "end" }>) {
		const driver = getDriver()

		for (const c of contacts) {
			if (c.type === "start") {
				if (this.activeContacts.size === 0) {
					this.touchStartTime = Date.now()
					this.touchMoved = false
					this.touchFingerCount = 0
				}
				this.activeContacts.set(c.id, { x: c.x, y: c.y })
				this.touchFingerCount = Math.max(this.touchFingerCount, this.activeContacts.size)

				if (this.activeContacts.size === 2) {
					const pts = Array.from(this.activeContacts.values())
					this.lastPinchDist = this.getTouchDistance(pts[0], pts[1])
				}
			} else if (c.type === "move") {
				const prev = this.activeContacts.get(c.id)
				if (!prev) continue

				const fingerCount = this.activeContacts.size

				const SCALE = 600
				const dx = (c.x - prev.x) * SCALE
				const dy = (c.y - prev.y) * SCALE

				if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
					this.touchMoved = true
				}

				if (fingerCount === 1) {
					driver.moveMouse(Math.round(dx), Math.round(dy))
				} else if (fingerCount === 2) {
					const pts = Array.from(this.activeContacts.values())
					const updatedPts = pts.map(p => ({ ...p }))
					const idx = Array.from(this.activeContacts.keys()).indexOf(c.id)
					if (idx >= 0) updatedPts[idx] = { x: c.x, y: c.y }

					if (updatedPts.length === 2) {
						const dist = this.getTouchDistance(updatedPts[0], updatedPts[1])

						if (this.lastPinchDist !== null) {
							const pinchDelta = dist - this.lastPinchDist
							const PINCH_THRESHOLD = 0.008

							if (Math.abs(pinchDelta) > PINCH_THRESHOLD) {
								const zoomAmount = Math.sign(pinchDelta) * 1.0
								driver.keyToggle(MODIFIER, true)
								driver.scroll(0, zoomAmount)
								driver.keyToggle(MODIFIER, false)
								this.lastPinchDist = dist
							} else {
								driver.scroll(Math.round(dx), Math.round(dy))
							}
						}
						this.lastPinchDist = dist
					}
				}

				this.activeContacts.set(c.id, { x: c.x, y: c.y })
			} else if (c.type === "end") {
				this.activeContacts.delete(c.id)

				if (this.activeContacts.size < 2) {
					this.lastPinchDist = null
				}

				if (this.activeContacts.size === 0) {
					const elapsed = Date.now() - this.touchStartTime
					if (!this.touchMoved && elapsed < 300) {
						if (this.touchFingerCount === 1) {
							driver.click("left", true)
							setTimeout(() => driver.click("left", false), 50)
						} else if (this.touchFingerCount === 2) {
							driver.click("right", true)
							setTimeout(() => driver.click("right", false), 50)
						} else if (this.touchFingerCount === 3) {
							driver.click("middle", true)
							setTimeout(() => driver.click("middle", false), 50)
						}
					}
					this.touchFingerCount = 0
				}
			}
		}
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

			case "touch":
				if (msg.contacts && Array.isArray(msg.contacts)) {
					this.handleTouchContacts(msg.contacts)
				}
				break
		}
	}
}
