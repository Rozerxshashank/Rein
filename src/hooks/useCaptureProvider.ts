import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Hook to handle screen capture from the browser and send to a WebSocket.
 * Implements backpressure and 30 FPS target.
 */
export function useCaptureProvider(wsRef: React.RefObject<WebSocket | null>) {
    const [isSharing, setIsSharing] = useState(false);
    const streamRef = useRef<MediaStream | null>(null);
    const intervalRef = useRef<number | null>(null);
    const isMounted = useRef(true);
    const isBusy = useRef(false);

    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
            if (intervalRef.current) window.clearTimeout(intervalRef.current);
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    const captureFrame = useCallback(async () => {
        if (!isSharing || !streamRef.current || !wsRef.current || isBusy.current) return;
        if (wsRef.current.readyState !== WebSocket.OPEN) return;

        // Use a persistent canvas to avoid GC churn
        const video = document.createElement('video');
        video.srcObject = streamRef.current;

        // Wait for metadata to get dimensions
        await new Promise((resolve) => {
            video.onloadedmetadata = resolve;
        });
        await video.play();

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;

        // Resize to target resolution (1280px width)
        const targetWidth = 1280;
        const scale = targetWidth / video.videoWidth;
        canvas.width = targetWidth;
        canvas.height = Math.floor(video.videoHeight * scale);

        isBusy.current = true;
        try {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            canvas.toBlob((blob) => {
                if (blob && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(blob);
                }
                isBusy.current = false;

                // Process video cleanup
                video.pause();
                video.srcObject = null;

                if (isMounted.current && isSharing) {
                    intervalRef.current = window.setTimeout(captureFrame, 33); // ~30 FPS
                }
            }, 'image/jpeg', 0.7);
        } catch (err) {
            console.error('Frame capture error:', err);
            isBusy.current = false;
            video.pause();
            video.srcObject = null;
        }
    }, [isSharing, wsRef]);

    const startSharing = async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    frameRate: { ideal: 30 },
                    width: { ideal: 1920 }
                },
                audio: false
            });

            streamRef.current = stream;

            // Register as a provider
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'start-provider' }));
            }

            // Watch for stop sharing from browser UI
            stream.getVideoTracks()[0].onended = () => {
                stopSharing();
            };

            setIsSharing(true);
            // Kickstart the loop
            setTimeout(captureFrame, 100);

        } catch (err) {
            console.error('Failed to start screen share:', err);
        }
    };

    const stopSharing = useCallback(() => {
        if (intervalRef.current) {
            window.clearTimeout(intervalRef.current);
            intervalRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        setIsSharing(false);
        isBusy.current = false;

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'stop-mirror' }));
        }
    }, [wsRef]);

    return {
        isSharing,
        startSharing,
        stopSharing
    };
}
