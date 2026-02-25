import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Hook to receive and render the screen mirror stream.
 * Uses ImageBitmap for background-thread decoding and rAF for sync painting.
 */
export function useMirrorStream(
    wsRef: React.RefObject<WebSocket | null>,
    canvasRef: React.RefObject<HTMLCanvasElement | null>,
    status: 'connecting' | 'connected' | 'disconnected'
) {
    const [hasFrame, setHasFrame] = useState(false);
    const frameRef = useRef<ImageBitmap | null>(null);
    const rAFRef = useRef<number | null>(null);

    const renderFrame = useCallback(() => {
        if (!canvasRef.current || !frameRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;

        // Only resize if dimensions changed
        if (canvas.width !== frameRef.current.width || canvas.height !== frameRef.current.height) {
            canvas.width = frameRef.current.width;
            canvas.height = frameRef.current.height;
        }

        ctx.drawImage(frameRef.current, 0, 0);
        rAFRef.current = null;
    }, [canvasRef]);

    const handleMessage = useCallback(async (event: MessageEvent) => {
        // Only process binary blob data (frames)
        if (!(event.data instanceof Blob)) return;

        try {
            // zero-copy background thread decoding
            const bitmap = await createImageBitmap(event.data);

            if (frameRef.current) {
                frameRef.current.close();
            }
            frameRef.current = bitmap;
            setHasFrame(true);

            if (!rAFRef.current) {
                rAFRef.current = requestAnimationFrame(renderFrame);
            }
        } catch (e) {
            console.error('Bitmap decoding error:', e);
        }
    }, [renderFrame]);

    useEffect(() => {
        const ws = wsRef.current;
        if (!ws || status !== 'connected') {
            setHasFrame(false);
            return;
        }

        // Set binary type for the socket
        ws.binaryType = 'blob';

        ws.addEventListener('message', handleMessage);

        // Register as a consumer
        ws.send(JSON.stringify({ type: 'start-mirror' }));

        return () => {
            ws.removeEventListener('message', handleMessage);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'stop-mirror' }));
            }
            if (rAFRef.current) cancelAnimationFrame(rAFRef.current);
            if (frameRef.current) frameRef.current.close();
        };
    }, [wsRef, status, handleMessage]);

    return { hasFrame };
}
