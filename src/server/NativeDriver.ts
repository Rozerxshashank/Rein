import koffi from "koffi"
import os from "node:os"
import { KEY_MAP } from "./KeyMap"

const platform = os.platform()

export interface TouchContact {
	id: number
	x: number
	y: number
	type: "start" | "move" | "end"
}

export interface INativeDriver {
	moveMouse(dx: number, dy: number): void
	click(button: "left" | "right" | "middle", press: boolean): void
	scroll(dx: number, dy: number): void
	keyTap(vk: number): void
	keyToggle(vk: number, press: boolean): void
	typeText(text: string): void
	touch(contacts: TouchContact[]): void
}

function createWindowsDriver(): INativeDriver {
	const user32 = koffi.load("user32.dll")

	const INPUT_MOUSE = 0
	const INPUT_KEYBOARD = 1

	const MOUSEEVENTF_LEFTDOWN = 0x0002
	const MOUSEEVENTF_LEFTUP = 0x0004
	const MOUSEEVENTF_RIGHTDOWN = 0x0008
	const MOUSEEVENTF_RIGHTUP = 0x0010
	const MOUSEEVENTF_MIDDLEDOWN = 0x0020
	const MOUSEEVENTF_MIDDLEUP = 0x0040
	const MOUSEEVENTF_WHEEL = 0x0800
	const MOUSEEVENTF_HWHEEL = 0x1000

	const KEYEVENTF_KEYUP = 0x0002
	const KEYEVENTF_UNICODE = 0x0004

	const MOUSEINPUT = koffi.struct("MOUSEINPUT", {
		dx: "long",
		dy: "long",
		mouseData: "uint32_t",
		dwFlags: "uint32_t",
		time: "uint32_t",
		dwExtraInfo: "uintptr_t",
	})
	const KEYBDINPUT = koffi.struct("KEYBDINPUT", {
		wVk: "uint16_t",
		wScan: "uint16_t",
		dwFlags: "uint32_t",
		time: "uint32_t",
		dwExtraInfo: "uintptr_t",
	})
	const HARDWAREINPUT = koffi.struct("HARDWAREINPUT", {
		uMsg: "uint32_t",
		wParamL: "uint16_t",
		wParamH: "uint16_t",
	})
	const INPUT = koffi.struct("INPUT", {
		type: "uint32_t",
		u: koffi.union({ mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT }),
	})

	const _POINT = koffi.struct("POINT", { x: "long", y: "long" }); void _POINT

	const MOUSEEVENTF_MOVE = 0x0001
	const MOUSEEVENTF_ABSOLUTE = 0x8000
	const MOUSEEVENTF_VIRTUALDESK = 0x4000

	const SendInput = user32.func(
		"unsigned int __stdcall SendInput(unsigned int cInputs, INPUT *pInputs, int cbSize)",
	)
	const GetCursorPos = user32.func(
		"bool __stdcall GetCursorPos(_Out_ POINT *lpPoint)",
	)
	const SetCursorPos = user32.func("bool __stdcall SetCursorPos(int X, int Y)")
	const GetSystemMetrics = user32.func("int __stdcall GetSystemMetrics(int nIndex)")
	const SZ = koffi.sizeof(INPUT)

	const screenW = GetSystemMetrics(0) || 1920
	const screenH = GetSystemMetrics(1) || 1080

	const InitializeTouchInjection = user32.func(
		"bool __stdcall InitializeTouchInjection(uint32_t maxCount, uint32_t dwMode)",
	)
	const InjectTouchInput = user32.func(
		"bool __stdcall InjectTouchInput(uint32_t count, const void *contacts)",
	)
	let touchInjectionReady = false
	try {
		touchInjectionReady = InitializeTouchInjection(10, 0x1)
		if (touchInjectionReady) console.log("Windows Touch Injection initialized.")
		else console.warn("InitializeTouchInjection returned false, falling back to SendInput for touch.")
	} catch (e) {
		console.warn("InitializeTouchInjection not available, falling back to SendInput for touch.", e)
	}

	const touchIdMap = new Map<number, number>()
	let nextTouchPid = 0

	return {
		moveMouse(dx, dy) {
			const pt: { x: number; y: number } = { x: 0, y: 0 }
			GetCursorPos(pt)
			SetCursorPos(pt.x + dx, pt.y + dy)
		},
		click(button, press) {
			let flag = 0
			if (button === "left")
				flag = press ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP
			else if (button === "right")
				flag = press ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP
			else if (button === "middle")
				flag = press ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP

			SendInput(1, [{ type: INPUT_MOUSE, u: { mi: { dx: 0, dy: 0, mouseData: 0, dwFlags: flag, time: 0, dwExtraInfo: 0 } } }], SZ)
		},
		scroll(dx, dy) {
			if (dy !== 0) SendInput(1, [{ type: INPUT_MOUSE, u: { mi: { dx: 0, dy: 0, mouseData: Math.round(dy * 40), dwFlags: MOUSEEVENTF_WHEEL, time: 0, dwExtraInfo: 0 } } }], SZ)
			if (dx !== 0) SendInput(1, [{ type: INPUT_MOUSE, u: { mi: { dx: 0, dy: 0, mouseData: Math.round(dx * 40), dwFlags: MOUSEEVENTF_HWHEEL, time: 0, dwExtraInfo: 0 } } }], SZ)
		},
		keyTap(vk) {
			SendInput(2, [
				{ type: INPUT_KEYBOARD, u: { ki: { wVk: vk, wScan: 0, dwFlags: 0, time: 0, dwExtraInfo: 0 } } },
				{ type: INPUT_KEYBOARD, u: { ki: { wVk: vk, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 } } }
			], SZ)
		},
		keyToggle(vk, press) {
			const flag = press ? 0 : KEYEVENTF_KEYUP
			SendInput(1, [{ type: INPUT_KEYBOARD, u: { ki: { wVk: vk, wScan: 0, dwFlags: flag, time: 0, dwExtraInfo: 0 } } }], SZ)
		},
		typeText(text) {
			for (const ch of text) {
				const c = ch.charCodeAt(0)
				SendInput(2, [
					{ type: INPUT_KEYBOARD, u: { ki: { wVk: 0, wScan: c, dwFlags: KEYEVENTF_UNICODE, time: 0, dwExtraInfo: 0 } } },
					{ type: INPUT_KEYBOARD, u: { ki: { wVk: 0, wScan: c, dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 } } }
				], SZ)
			}
		},
		touch(contacts) {
			if (contacts.length === 0) return

			if (touchInjectionReady) {
				const count = contacts.length
				const STRUCT_SIZE = 144
				const buffer = Buffer.alloc(STRUCT_SIZE * count)

				for (let i = 0; i < count; i++) {
					const c = contacts[i]
					const x = Math.max(0, Math.min(screenW - 1, Math.round(c.x * screenW)))
					const y = Math.max(0, Math.min(screenH - 1, Math.round(c.y * screenH)))

					if (!touchIdMap.has(c.id)) {
						touchIdMap.set(c.id, nextTouchPid++ % 10)
					}
					const pid = touchIdMap.get(c.id)!

					const POINTER_FLAG_INRANGE = 0x00000002
					const POINTER_FLAG_INCONTACT = 0x00000004
					const POINTER_FLAG_DOWN = 0x00010000
					const POINTER_FLAG_UPDATE = 0x00020000
					const POINTER_FLAG_UP = 0x00040000

					let flags = POINTER_FLAG_DOWN | POINTER_FLAG_INRANGE | POINTER_FLAG_INCONTACT
					if (c.type === "move") flags = POINTER_FLAG_UPDATE | POINTER_FLAG_INRANGE | POINTER_FLAG_INCONTACT
					else if (c.type === "end") {
						flags = POINTER_FLAG_UP
						touchIdMap.delete(c.id)
					}

					const off = i * STRUCT_SIZE
					buffer.writeUInt32LE(0x02, off + 0)
					buffer.writeUInt32LE(pid, off + 4)
					buffer.writeUInt32LE(0, off + 8)
					buffer.writeUInt32LE(flags, off + 12)

					buffer.writeInt32LE(x, off + 32)
					buffer.writeInt32LE(y, off + 36)
					buffer.writeInt32LE(x, off + 40)
					buffer.writeInt32LE(y, off + 44)
					buffer.writeInt32LE(x, off + 48)
					buffer.writeInt32LE(y, off + 52)

					buffer.writeUInt32LE(0, off + 96)
					buffer.writeUInt32LE(0x01 | 0x02, off + 100)

					buffer.writeInt32LE(x - 2, off + 104)
					buffer.writeInt32LE(y - 2, off + 108)
					buffer.writeInt32LE(x + 2, off + 112)
					buffer.writeInt32LE(y + 2, off + 116)
				}

				const ok = InjectTouchInput(count, buffer)
				if (!ok) {
					touchFallback(contacts)
				}
			} else {
				touchFallback(contacts)
			}
		},
	}

	function touchFallback(contacts: TouchContact[]) {
		const first = contacts[0]
		if (!first) return
		const absX = Math.round(first.x * 65535)
		const absY = Math.round(first.y * 65535)

		let mouseFlags = MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK
		if (first.type === "start") mouseFlags |= MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_MOVE
		else if (first.type === "move") mouseFlags |= MOUSEEVENTF_MOVE
		else if (first.type === "end") mouseFlags |= MOUSEEVENTF_LEFTUP

		SendInput(1, [{ type: INPUT_MOUSE, u: { mi: { dx: absX, dy: absY, mouseData: 0, dwFlags: mouseFlags, time: 0, dwExtraInfo: 0 } } }], SZ)
	}
}

function createLinuxDriver(): INativeDriver {
	let libc: any
	try {
		libc = koffi.load("libc.so.6")
	} catch (e) {
		console.warn("Could not load libc.so.6, Linux driver will be a stub.")
		return createStubDriver()
	}

	const input_event = koffi.struct("input_event", {
		tv_sec: "long",
		tv_usec: "long",
		type: "uint16_t",
		code: "uint16_t",
		value: "int32_t",
	})
	const _uinput_setup = koffi.struct("uinput_setup", {
		id_bustype: "uint16_t",
		id_vendor: "uint16_t",
		id_product: "uint16_t",
		id_version: "uint16_t",
		name: koffi.array("char", 80),
		ff_effects_max: "uint32_t",
	}); void _uinput_setup
	const EVENT_SIZE = koffi.sizeof(input_event)

	const open = libc.func("int open(const char *path, int flags)")
	const ioctl_int = libc.func("int ioctl(int fd, unsigned long request, int value)")
	const ioctl_ptr = libc.func("int ioctl(int fd, unsigned long request, uinput_setup *arg)")
	const write_event = libc.func("intptr_t write(int fd, const input_event *buf, uintptr_t count)")

	const O_WRONLY = 1
	const O_NONBLOCK = 2048
	const UI_SET_EVBIT = 0x40045564
	const UI_SET_KEYBIT = 0x40045565
	const UI_SET_RELBIT = 0x40045566
	const UI_DEV_SETUP = 0x405c5503
	const UI_DEV_CREATE = 0x5501
	const EV_SYN = 0x00
	const EV_KEY = 0x01
	const EV_REL = 0x02
	const REL_X = 0x00
	const REL_Y = 0x01
	const REL_WHEEL = 0x08
	const REL_HWHEEL = 0x06
	const BTN_LEFT = 0x110
	const BTN_RIGHT = 0x111
	const BTN_MIDDLE = 0x112
	const BTN_TOUCH = 0x14a
	const ABS_MT_SLOT = 0x2f
	const ABS_MT_TRACKING_ID = 0x39
	const ABS_MT_POSITION_X = 0x35
	const ABS_MT_POSITION_Y = 0x36

	const EV_ABS = 0x03
	const UI_SET_ABSBIT = 0x40045567

	let fd = -1
	try {
		fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK)
		if (fd < 0) {
			console.error("=== UINPUT FAILED ===")
			console.error("Could not open /dev/uinput (permission denied)")
			console.error("Fix: sudo usermod -aG input $USER  (then LOG OUT and log back in)")
			console.error("=====================")
			return createStubDriver()
		}

		ioctl_int(fd, UI_SET_EVBIT, EV_KEY)
		ioctl_int(fd, UI_SET_EVBIT, EV_REL)
		ioctl_int(fd, UI_SET_EVBIT, EV_SYN)
		ioctl_int(fd, UI_SET_KEYBIT, BTN_LEFT)
		ioctl_int(fd, UI_SET_KEYBIT, BTN_RIGHT)
		ioctl_int(fd, UI_SET_KEYBIT, BTN_MIDDLE)
		ioctl_int(fd, UI_SET_RELBIT, REL_X)
		ioctl_int(fd, UI_SET_RELBIT, REL_Y)
		ioctl_int(fd, UI_SET_RELBIT, REL_WHEEL)
		ioctl_int(fd, UI_SET_RELBIT, REL_HWHEEL)
		for (let i = 1; i < 256; i++) ioctl_int(fd, UI_SET_KEYBIT, i)

		try {
			ioctl_int(fd, UI_SET_EVBIT, EV_ABS)
			ioctl_int(fd, UI_SET_KEYBIT, BTN_TOUCH)
			ioctl_int(fd, UI_SET_ABSBIT, ABS_MT_SLOT)
			ioctl_int(fd, UI_SET_ABSBIT, ABS_MT_TRACKING_ID)
			ioctl_int(fd, UI_SET_ABSBIT, ABS_MT_POSITION_X)
			ioctl_int(fd, UI_SET_ABSBIT, ABS_MT_POSITION_Y)

			const UI_ABS_SETUP = 0x401c5504
			const absSetup = Buffer.alloc(28)

			absSetup.writeUInt16LE(ABS_MT_SLOT, 0)
			absSetup.writeInt32LE(0, 4)
			absSetup.writeInt32LE(9, 8)
			absSetup.writeInt32LE(0, 12)
			absSetup.writeInt32LE(0, 16)
			absSetup.writeInt32LE(0, 20)
			ioctl_ptr(fd, UI_ABS_SETUP, absSetup)

			const posSetupX = Buffer.alloc(28)
			posSetupX.writeUInt16LE(ABS_MT_POSITION_X, 0)
			posSetupX.writeInt32LE(0, 4)
			posSetupX.writeInt32LE(32767, 8)
			posSetupX.writeInt32LE(0, 12)
			posSetupX.writeInt32LE(0, 16)
			posSetupX.writeInt32LE(0, 20)
			ioctl_ptr(fd, UI_ABS_SETUP, posSetupX)

			const posSetupY = Buffer.alloc(28)
			posSetupY.writeUInt16LE(ABS_MT_POSITION_Y, 0)
			posSetupY.writeInt32LE(0, 4)
			posSetupY.writeInt32LE(32767, 8)
			posSetupY.writeInt32LE(0, 12)
			posSetupY.writeInt32LE(0, 16)
			posSetupY.writeInt32LE(0, 20)
			ioctl_ptr(fd, UI_ABS_SETUP, posSetupY)

			const trackSetup = Buffer.alloc(28)
			trackSetup.writeUInt16LE(ABS_MT_TRACKING_ID, 0)
			trackSetup.writeInt32LE(0, 4)
			trackSetup.writeInt32LE(65535, 8)
			trackSetup.writeInt32LE(0, 12)
			trackSetup.writeInt32LE(0, 16)
			trackSetup.writeInt32LE(0, 20)
			ioctl_ptr(fd, UI_ABS_SETUP, trackSetup)
		} catch {
			console.warn("Multi-touch setup skipped (kernel may not support it)")
		}

		const setup: any = {
			id_bustype: 0x03,
			id_vendor: 0x1234,
			id_product: 0x5678,
			id_version: 1,
			name: Buffer.from("rein-virtual-input".padEnd(80, "\0")),
			ff_effects_max: 0,
		}
		ioctl_ptr(fd, UI_DEV_SETUP, setup)
		ioctl_int(fd, UI_DEV_CREATE, 0)
		console.log("uinput device created successfully (fd=" + fd + ")")
	} catch (e) {
		console.error("Failed to initialize uinput:", e)
		console.error("Fix: sudo usermod -aG input $USER  (then LOG OUT and log back in)")
		return createStubDriver()
	}

	const emitRaw = (type: number, code: number, value: number) => {
		if (fd < 0) return
		write_event(fd, { tv_sec: 0, tv_usec: 0, type, code, value }, EVENT_SIZE)
	}
	const syn = () => { emitRaw(EV_SYN, 0, 0) }
	const emit = (type: number, code: number, value: number) => {
		emitRaw(type, code, value)
		syn()
	}

	const linuxTouchSlots = new Map<number, number>()
	let nextSlot = 0

	return {
		moveMouse(dx, dy) { emit(EV_REL, REL_X, dx); emit(EV_REL, REL_Y, dy); },
		click(button, press) {
			let code = BTN_LEFT
			if (button === "right") code = BTN_RIGHT
			else if (button === "middle") code = BTN_MIDDLE
			emit(EV_KEY, code, press ? 1 : 0)
		},
		scroll(dx, dy) {
			const scrollY = Math.abs(dy) < 1 && dy !== 0 ? Math.sign(dy) : Math.round(dy)
			const scrollX = Math.abs(dx) < 1 && dx !== 0 ? Math.sign(dx) : Math.round(dx)
			if (scrollY !== 0) emit(EV_REL, REL_WHEEL, scrollY)
			if (scrollX !== 0) emit(EV_REL, REL_HWHEEL, scrollX)
		},
		keyTap(vk) { emit(EV_KEY, vk, 1); emit(EV_KEY, vk, 0); },
		keyToggle(vk, press) { emit(EV_KEY, vk, press ? 1 : 0); },
		typeText(text) {
			for (const ch of text) {
				const lower = ch.toLowerCase()
				const code = KEY_MAP[lower]
				if (code) {
					const needsShift = ch !== lower
					if (needsShift && KEY_MAP.shift) emit(EV_KEY, KEY_MAP.shift, 1)
					emit(EV_KEY, code, 1)
					emit(EV_KEY, code, 0)
					if (needsShift && KEY_MAP.shift) emit(EV_KEY, KEY_MAP.shift, 0)
				}
			}
		},
		touch(contacts) {
			for (const c of contacts) {
				if (c.type === "start" && !linuxTouchSlots.has(c.id)) {
					linuxTouchSlots.set(c.id, nextSlot++ % 10)
				}
				const slot = linuxTouchSlots.get(c.id)
				if (slot === undefined) continue

				emitRaw(EV_ABS, ABS_MT_SLOT, slot)
				if (c.type === "end") {
					emitRaw(EV_ABS, ABS_MT_TRACKING_ID, -1)
					linuxTouchSlots.delete(c.id)
				} else {
					if (c.type === "start") emitRaw(EV_ABS, ABS_MT_TRACKING_ID, c.id)
					emitRaw(EV_ABS, ABS_MT_POSITION_X, Math.round(c.x * 32767))
					emitRaw(EV_ABS, ABS_MT_POSITION_Y, Math.round(c.y * 32767))
				}
			}
			syn()
		},
	}
}

function createMacOSDriver(): INativeDriver {
	let cg: any
	try {
		cg = koffi.load("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
	} catch (e) {
		console.warn("Could not load CoreGraphics, macOS driver will be a stub.", e)
		return createStubDriver()
	}

	const kCGEventMouseMoved = 5
	const kCGEventLeftMouseDown = 1
	const kCGEventLeftMouseUp = 2
	const kCGEventRightMouseDown = 3
	const kCGEventRightMouseUp = 4
	const kCGEventOtherMouseDown = 25
	const kCGEventOtherMouseUp = 26


	const kCGEventSourceStateHIDSystemState = 1

	const kCGScrollEventUnitPixel = 1

	const _CGPoint = koffi.struct("CGPoint", {
		x: "double",
		y: "double",
	}); void _CGPoint

	const CGEventSourceCreate = cg.func("void* CGEventSourceCreate(int32_t stateID)")
	const CGEventCreateMouseEvent = cg.func(
		"void* CGEventCreateMouseEvent(void* source, int32_t mouseType, CGPoint mouseCursorPosition, int32_t mouseButton)"
	)
	const CGEventCreateKeyboardEvent = cg.func(
		"void* CGEventCreateKeyboardEvent(void* source, uint16_t virtualKey, bool keyDown)"
	)
	const CGEventCreateScrollWheelEvent = cg.func(
		"void* CGEventCreateScrollWheelEvent(void* source, int32_t units, uint32_t wheelCount, int32_t wheel1, int32_t wheel2)"
	)
	const CGEventPost = cg.func("void CGEventPost(int32_t tap, void* event)")
	const CFRelease = cg.func("void CFRelease(void* cf)")
	const CGEventGetLocation = cg.func("CGPoint CGEventGetLocation(void* event)")
	const CGEventCreate = cg.func("void* CGEventCreate(void* source)")
	const CGEventKeyboardSetUnicodeString = cg.func(
		"void CGEventKeyboardSetUnicodeString(void* event, unsigned long stringLength, const uint16_t *unicodeString)"
	)

	const kCGHIDEventTap = 0

	const getMousePos = (): { x: number; y: number } => {
		const event = CGEventCreate(null)
		const pos = CGEventGetLocation(event)
		CFRelease(event)
		return { x: pos.x, y: pos.y }
	}

	const postEvent = (event: any) => {
		if (!event) return
		CGEventPost(kCGHIDEventTap, event)
		CFRelease(event)
	}

	const source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState)

	return {
		moveMouse(dx, dy) {
			const pos = getMousePos()
			const newX = pos.x + dx
			const newY = pos.y + dy
			const event = CGEventCreateMouseEvent(source, kCGEventMouseMoved, { x: newX, y: newY }, 0)
			postEvent(event)
		},
		click(button, press) {
			const pos = getMousePos()
			let downType: number
			let upType: number
			let btnCode: number

			if (button === "right") {
				downType = kCGEventRightMouseDown
				upType = kCGEventRightMouseUp
				btnCode = 1
			} else if (button === "middle") {
				downType = kCGEventOtherMouseDown
				upType = kCGEventOtherMouseUp
				btnCode = 2
			} else {
				downType = kCGEventLeftMouseDown
				upType = kCGEventLeftMouseUp
				btnCode = 0
			}

			const eventType = press ? downType : upType
			const event = CGEventCreateMouseEvent(source, eventType, { x: pos.x, y: pos.y }, btnCode)
			postEvent(event)
		},
		scroll(dx, dy) {
			const scrollY = Math.abs(dy) < 1 && dy !== 0 ? Math.sign(dy) : Math.round(dy)
			const scrollX = Math.abs(dx) < 1 && dx !== 0 ? Math.sign(dx) : Math.round(dx)
			const event = CGEventCreateScrollWheelEvent(
				source, kCGScrollEventUnitPixel, 2,
				scrollY, scrollX
			)
			postEvent(event)
		},
		keyTap(vk) {
			const down = CGEventCreateKeyboardEvent(source, vk, true)
			postEvent(down)
			const up = CGEventCreateKeyboardEvent(source, vk, false)
			postEvent(up)
		},
		keyToggle(vk, press) {
			const event = CGEventCreateKeyboardEvent(source, vk, press)
			postEvent(event)
		},
		typeText(text) {
			for (const ch of text) {
				const charCode = ch.charCodeAt(0)
				const buf = Buffer.alloc(2)
				buf.writeUInt16LE(charCode, 0)

				const down = CGEventCreateKeyboardEvent(source, 0, true)
				CGEventKeyboardSetUnicodeString(down, 1, buf)
				CGEventPost(kCGHIDEventTap, down)
				CFRelease(down)

				const up = CGEventCreateKeyboardEvent(source, 0, false)
				CGEventKeyboardSetUnicodeString(up, 1, buf)
				CGEventPost(kCGHIDEventTap, up)
				CFRelease(up)
			}
		},
		touch(contacts) {
			if (contacts.length === 0) return
			const first = contacts[0]
			if (first.type === "move" || first.type === "start") {
				const event = CGEventCreateMouseEvent(
					source, kCGEventMouseMoved,
					{ x: first.x * 1920, y: first.y * 1080 }, 0
				)
				postEvent(event)
			}
		},
	}
}

function createStubDriver(): INativeDriver {
	return {
		moveMouse: () => { }, click: () => { }, scroll: () => { }, keyTap: () => { }, keyToggle: () => { }, typeText: () => { }, touch: () => { },
	}
}

const DRIVER_KEY = "__rein_native_driver__" as const;

export const getDriver = (): INativeDriver => {
	if (!(globalThis as any)[DRIVER_KEY]) {
		(globalThis as any)[DRIVER_KEY] = platform === "win32"
			? createWindowsDriver()
			: platform === "linux"
				? createLinuxDriver()
				: platform === "darwin"
					? createMacOSDriver()
					: createStubDriver();
	}
	return (globalThis as any)[DRIVER_KEY];
};
