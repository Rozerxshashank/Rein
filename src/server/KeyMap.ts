import os from "node:os"

const platform = os.platform()

/**
 * Windows Virtual-Key Codes (Standard)
 */
const WIN_KEYS: Record<string, number> = {
	shift: 0x10,
	control: 0x11,
	ctrl: 0x11,
	alt: 0x12,
	meta: 0x5b,
	super: 0x5b,
	backspace: 0x08,
	enter: 0x0d,
	return: 0x0d,
	tab: 0x09,
	escape: 0x1b,
	esc: 0x1b,
	space: 0x20,
	delete: 0x2e,
	del: 0x2e,
	up: 0x26,
	down: 0x28,
	left: 0x25,
	right: 0x27,
	f1: 0x70,
	f2: 0x71,
	f3: 0x72,
	f4: 0x73,
	f5: 0x74,
	f6: 0x75,
	f7: 0x76,
	f8: 0x77,
	f9: 0x78,
	f10: 0x79,
	f11: 0x7a,
	f12: 0x7b,
	// Add more as needed, or map alphanumeric dynamically
}

/**
 * Linux Evdev Key Codes (from linux/input-event-codes.h)
 */
const LINUX_KEYS: Record<string, number> = {
	shift: 42,
	control: 29,
	ctrl: 29,
	alt: 56,
	meta: 125,
	super: 125,
	backspace: 14,
	enter: 28,
	return: 28,
	tab: 15,
	escape: 1,
	esc: 1,
	space: 57,
	delete: 111,
	del: 111,
	up: 103,
	down: 108,
	left: 105,
	right: 106,
	f1: 59,
	f2: 60,
	f3: 61,
	f4: 62,
	f5: 63,
	f6: 64,
	f7: 65,
	f8: 66,
	f9: 67,
	f10: 68,
	f11: 87,
	f12: 88,
}

/**
 * macOS Virtual Key Codes (Carbon HIToolbox/Events.h)
 */
const MAC_KEYS: Record<string, number> = {
	shift: 56,
	control: 59,
	ctrl: 59,
	alt: 58,
	option: 58,
	meta: 55, // Command key
	command: 55,
	super: 55,
	backspace: 51,
	enter: 36,
	return: 36,
	tab: 48,
	escape: 53,
	esc: 53,
	space: 49,
	delete: 117,
	del: 117,
	up: 126,
	down: 125,
	left: 123,
	right: 124,
	f1: 122,
	f2: 120,
	f3: 99,
	f4: 118,
	f5: 96,
	f6: 97,
	f7: 98,
	f8: 100,
	f9: 101,
	f10: 109,
	f11: 103,
	f12: 111,
}

// Simple alphanumeric mapping for demo/core keys
const ALPHANUM = "abcdefghijklmnopqrstuvwxyz0123456789"
if (platform === "win32") {
	for (let i = 0; i < ALPHANUM.length; i++) {
		const char = ALPHANUM[i]
		WIN_KEYS[char] = char.toUpperCase().charCodeAt(0)
	}
} else if (platform === "linux") {
	// Basic mapping for a-z (linux codes are different from ASCII)
	const linuxAlpha = [
		30, 48, 46, 32, 18, 33, 34, 35, 23, 36, 37, 38, 50, 49, 24, 25, 16, 19, 31,
		20, 22, 47, 17, 45, 21, 44,
	]
	for (let i = 0; i < 26; i++) {
		LINUX_KEYS[String.fromCharCode(97 + i)] = linuxAlpha[i]
	}
	// numbers 1-0 -> 2-11
	for (let i = 1; i <= 9; i++) LINUX_KEYS[i.toString()] = i + 1
	LINUX_KEYS["0"] = 11
} else if (platform === "darwin") {
	// macOS key codes for a-z
	const macAlpha = [
		0, 11, 8, 2, 14, 3, 5, 4, 34, 38, 40, 37, 46, 45, 31, 35, 12, 15, 1,
		17, 32, 9, 13, 7, 16, 6,
	]
	for (let i = 0; i < 26; i++) {
		MAC_KEYS[String.fromCharCode(97 + i)] = macAlpha[i]
	}
	// numbers 0-9
	const macNum = [29, 18, 19, 20, 21, 23, 22, 26, 28, 25]
	for (let i = 0; i <= 9; i++) MAC_KEYS[i.toString()] = macNum[i]
}

export const KEY_MAP: Record<string, number> =
	platform === "win32" ? WIN_KEYS : platform === "linux" ? LINUX_KEYS : platform === "darwin" ? MAC_KEYS : {}
export const MODIFIER: number =
	platform === "win32"
		? WIN_KEYS.ctrl
		: platform === "linux"
			? LINUX_KEYS.ctrl
			: platform === "darwin"
				? MAC_KEYS.command // macOS uses Cmd for copy/paste
				: 0
