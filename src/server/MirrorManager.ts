import { spawn, type ChildProcess } from "node:child_process"
import os from "node:os"
import { WebSocket } from "ws"

const platform = os.platform()

export class MirrorManager {
	private gstProcess: ChildProcess | null = null
	private relayWs: WebSocket | null = null

	constructor() {}

	public async startMirror(targetIp: string, ws: WebSocket | null = null) {
		if (this.gstProcess) {
			this.stopMirror()
		}

		this.relayWs = ws
		const pipeline = this.getPipeline(targetIp)
		console.log(`Starting GStreamer pipeline: ${pipeline}`)

		// Use shell: true if needed for complex pipelines, but split is safer
		this.gstProcess = spawn("gst-launch-1.0", pipeline.split(" "), {
			stdio: ["ignore", "pipe", "inherit"], // capture stdout for appsink relay
		})

		if (this.relayWs) {
			this.gstProcess.stdout?.on("data", (data: Buffer) => {
				if (this.relayWs?.readyState === WebSocket.OPEN) {
					this.relayWs.send(data, { binary: true })
				}
			})
		}

		this.gstProcess.on("error", (err) => {
			console.error("Failed to start GStreamer process:", err)
		})

		this.gstProcess.on("close", (code) => {
			console.log(`GStreamer process exited with code ${code}`)
			this.gstProcess = null
		})
	}

	public stopMirror() {
		if (this.gstProcess) {
			this.gstProcess.kill()
			this.gstProcess = null
			this.relayWs = null
			console.log("GStreamer pipeline stopped.")
		}
	}

	private getPipeline(targetIp: string): string {
		const BITRATE = 10000 // 10Mbps

		// Logic:
		// 1. If relayWs is provided, we use appsink to pipe data to WebSocket.
		// 2. We also maintain udpsink for native mobile apps.
		// 3. We use jpegenc for WebSocket compatibility (React app uses ImageBitmap).

		if (platform === "win32") {
			const capture = "dxgicapturesrc ! videoconvert"
			if (this.relayWs) {
				// For web app: encode to MJPEG and pipe to stdout
				return `${capture} ! videoscale ! video/x-raw,width=1280,height=720 ! jpegenc quality=80 ! fdsink fd=1`
			} else {
				// For native app: encode to H.264 and send over UDP
				return `${capture} ! nvh264enc preset=low-latency-hp zerolatency=true rc-mode=cbr bitrate=${BITRATE} ! rtph264pay config-interval=1 pt=96 ! udpsink host=${targetIp} port=5400 sync=false`
			}
		} else if (platform === "linux") {
			const capture = "pipewiresrc ! videoconvert"
			if (this.relayWs) {
				return `${capture} ! videoscale ! video/x-raw,width=1280,height=720 ! jpegenc quality=80 ! fdsink fd=1`
			} else {
				return `${capture} ! nvh264enc preset=low-latency-hp zerolatency=true rc-mode=cbr bitrate=${BITRATE} ! rtph264pay config-interval=1 pt=96 ! udpsink host=${targetIp} port=5400 sync=false`
			}
		} else if (platform === "darwin") {
			const capture = "avfvideosrc capture-screen=true ! videoconvert"
			if (this.relayWs) {
				return `${capture} ! videoscale ! video/x-raw,width=1280,height=720 ! jpegenc quality=80 ! fdsink fd=1`
			} else {
				return `${capture} ! vtenc_h264 realtime=true bitrate=${BITRATE} ! rtph264pay config-interval=1 pt=96 ! udpsink host=${targetIp} port=5400 sync=false`
			}
		}

		return ""
	}
}

export const mirrorManager = new MirrorManager()
