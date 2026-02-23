import React from 'react';

interface TouchAreaProps {
    scrollMode: boolean;
    isTracking: boolean;
    handlers: {
        onTouchStart: (e: React.TouchEvent) => void;
        onTouchMove: (e: React.TouchEvent) => void;
        onTouchEnd: (e: React.TouchEvent) => void;
    };
    status: 'connecting' | 'connected' | 'disconnected';
}

export const TouchArea: React.FC<TouchAreaProps> = ({ scrollMode, isTracking, handlers, status }) => {
    return (
        <div
            style={{
                flex: 1,
                width: "100%",
                height: "100%",
                background: "#0d0d0f",
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                touchAction: "none",
                userSelect: "none",
                WebkitUserSelect: "none",
            }}
            onTouchStart={handlers.onTouchStart}
            onTouchMove={handlers.onTouchMove}
            onTouchEnd={handlers.onTouchEnd}
            onMouseDown={(e) => e.preventDefault()}
        >
            {/* Status strip at very top */}
            <div style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 3,
                background: status === "connected" ? "#22c55e" : status === "connecting" ? "#f59e0b" : "#ef4444",
            }} />

            {/* Center hint */}
            <div style={{
                color: "#ffffff0d",
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: 2,
                pointerEvents: "none",
                userSelect: "none",
            }}>
                {scrollMode ? "SCROLL" : ""}
            </div>

            {/* Tracking indicator */}
            {isTracking && (
                <div style={{
                    position: "absolute",
                    bottom: 16,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 28,
                    height: 28,
                    border: "3px solid #a78bfa",
                    borderTopColor: "transparent",
                    borderRadius: "50%",
                    animation: "spin 0.7s linear infinite",
                }} />
            )}

            {/* Scroll badge */}
            {scrollMode && (
                <div style={{
                    position: "absolute",
                    top: 12,
                    right: 12,
                    background: "#1e40af",
                    color: "#93c5fd",
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 20,
                    letterSpacing: 1,
                }}>
                    SCROLL
                </div>
            )}

            <style>{`@keyframes spin { to { transform: translateX(-50%) rotate(360deg); } }`}</style>
        </div>
    );
};
