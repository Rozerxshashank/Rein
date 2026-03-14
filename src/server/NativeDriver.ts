import koffi from "koffi"
import os from "node:os"
import { KEY_MAP } from "./KeyMap"

const platform = os.platform()

export interface INativeDriver {
	moveMouse(dx: number, dy: number): void
	click(button: "left" | "right" | "middle", press: boolean): void
	scroll(dx: number, dy: number): void
	keyTap(vk: number): void
	keyToggle(vk: number, press: boolean): void
	typeText(text: string): void
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
	
	const POINT = koffi.struct("POINT", { x: "long", y: "long" })

	const SendInput = user32.func(
		"unsigned int __stdcall SendInput(unsigned int cInputs, INPUT *pInputs, int cbSize)",
	)
	const GetCursorPos = user32.func(
		"bool __stdcall GetCursorPos(_Out_ POINT *lpPoint)",
	)
	const SetCursorPos = user32.func("bool __stdcall SetCursorPos(int X, int Y)")
	const SZ = koffi.sizeof(INPUT)

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
			if (dy !== 0) SendInput(1, [{ type: INPUT_MOUSE, u: { mi: { dx: 0, dy: 0, mouseData: Math.round(dy * 120), dwFlags: MOUSEEVENTF_WHEEL, time: 0, dwExtraInfo: 0 } } }], SZ)
			if (dx !== 0) SendInput(1, [{ type: INPUT_MOUSE, u: { mi: { dx: 0, dy: 0, mouseData: Math.round(dx * 120), dwFlags: MOUSEEVENTF_HWHEEL, time: 0, dwExtraInfo: 0 } } }], SZ)
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
    const uinput_setup = koffi.struct("uinput_setup", {
        id_bustype: "uint16_t",
        id_vendor: "uint16_t",
        id_product: "uint16_t",
        id_version: "uint16_t",
        name: koffi.array("char", 80),
        ff_effects_max: "uint32_t",
    })
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

	const emit = (type: number, code: number, value: number) => {
		if (fd < 0) return
		write_event(fd, { tv_sec: 0, tv_usec: 0, type, code, value }, EVENT_SIZE)
		write_event(fd, { tv_sec: 0, tv_usec: 0, type: EV_SYN, code: 0, value: 0 }, EVENT_SIZE)
	}

	return {
		moveMouse(dx, dy) { emit(EV_REL, REL_X, dx); emit(EV_REL, REL_Y, dy); },
		click(button, press) {
			let code = BTN_LEFT
			if (button === "right") code = BTN_RIGHT
			else if (button === "middle") code = BTN_MIDDLE
			emit(EV_KEY, code, press ? 1 : 0)
		},
		scroll(dx, dy) {
			if (dy !== 0) emit(EV_REL, REL_WHEEL, Math.round(dy))
			if (dx !== 0) emit(EV_REL, REL_HWHEEL, Math.round(dx))
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

	const CGPoint = koffi.struct("CGPoint", {
		x: "double",
		y: "double",
	})

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
			const event = CGEventCreateScrollWheelEvent(
				source, kCGScrollEventUnitPixel, 2,
				Math.round(dy), Math.round(dx)
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
				const code = ch.charCodeAt(0)
				if (code >= 32 && code <= 126) {
					const down = CGEventCreateKeyboardEvent(source, 0, true)
					postEvent(down)
					const up = CGEventCreateKeyboardEvent(source, 0, false)
					postEvent(up)
				}
			}
			console.warn("typeText on macOS: basic implementation, may not handle all characters")
		},
	}
}

function createStubDriver(): INativeDriver {
	return {
		moveMouse: () => {}, click: () => {}, scroll: () => {}, keyTap: () => {}, keyToggle: () => {}, typeText: () => {},
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
