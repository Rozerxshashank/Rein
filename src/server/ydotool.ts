import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

// Cache the availability of ydotool to avoid repeated checks
let isYdotoolAvailable: boolean | null = null
let ydotoolPath: string | null = null

/**
 * Checks if ydotool is available on the system.
 */
export async function checkYdotool(): Promise<boolean> {
	if (isYdotoolAvailable !== null) {
		return isYdotoolAvailable
	}

	try {
		// Suppress error output if not found, we only care if it succeeds or fails
		const { stdout } = await execFileAsync("which", ["ydotool"])
		ydotoolPath = stdout.trim()
		isYdotoolAvailable = !!ydotoolPath
		if (isYdotoolAvailable) {
			console.log(`[ydotool] Found at ${ydotoolPath}`)
		}
	} catch (err) {
		isYdotoolAvailable = false
		console.warn(
			"[ydotool] ydotool is not available, falling back to nut.js for cursor movement.",
		)
	}

	return isYdotoolAvailable
}

/**
 * Moves the mouse cursor relatively using ydotool.
 *
 * @param dx X offset
 * @param dy Y offset
 * @returns true if successful, false otherwise
 */
export async function moveRelative(dx: number, dy: number): Promise<boolean> {
	if (!(await checkYdotool()) || !ydotoolPath) {
		return false
	}

	try {
		// ydotool mousemove -x <dx> -y <dy>
		await execFileAsync(ydotoolPath, [
			"mousemove",
			"-x",
			String(dx),
			"-y",
			String(dy),
		])
		return true
	} catch (err) {
		console.error("[ydotool] Error executing mousemove:", err)
		// Consider it unavailable for future calls to avoid repeated failing attempts
		isYdotoolAvailable = false
		return false
	}
}
