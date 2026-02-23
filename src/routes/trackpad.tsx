import { createFileRoute } from '@tanstack/react-router'
import { useState, useRef, useEffect } from 'react'
import { useRemoteConnection } from '../hooks/useRemoteConnection';
import { useTrackpadGesture } from '../hooks/useTrackpadGesture';
import { ControlBar } from '../components/Trackpad/ControlBar';
import { ExtraKeys } from '../components/Trackpad/ExtraKeys';
import { TouchArea } from '../components/Trackpad/TouchArea';
import { BufferBar } from '@/components/Trackpad/Buffer';
import { ModifierState } from '@/types';

export const Route = createFileRoute('/trackpad')({
    component: TrackpadPage,
})

function TrackpadPage() {
    const [scrollMode, setScrollMode] = useState(false);
    const [modifier, setModifier] = useState<ModifierState>("Release");
    const [buffer, setBuffer] = useState<string[]>([]);
    const [keyboardOpen, setKeyboardOpen] = useState(false);
    const [extraKeysVisible, setExtraKeysVisible] = useState(true);

    const bufferText = buffer.join(" + ");
    const hiddenInputRef = useRef<HTMLInputElement>(null);
    const isComposingRef = useRef(false);

    const [sensitivity] = useState(() => {
        if (typeof window === 'undefined') return 1.0;
        const s = localStorage.getItem('rein_sensitivity');
        return s ? parseFloat(s) : 1.0;
    });

    const [invertScroll] = useState(() => {
        if (typeof window === 'undefined') return false;
        const s = localStorage.getItem('rein_invert');
        return s ? JSON.parse(s) : false;
    });

    const { status, send, sendCombo } = useRemoteConnection();
    const { isTracking, handlers } = useTrackpadGesture(send, scrollMode, sensitivity, invertScroll);

    // When keyboardOpen changes, focus or blur the hidden input
    useEffect(() => {
        if (keyboardOpen) {
            hiddenInputRef.current?.focus();
        } else {
            hiddenInputRef.current?.blur();
        }
    }, [keyboardOpen]);

    const toggleKeyboard = () => {
        setKeyboardOpen(prev => !prev);
    };

    // Silent focus for ExtraKeys — does NOT open mobile keyboard
    // ExtraKeys send via callback so they don't actually need input focus,
    // but keep this in case it's used elsewhere.
    const focusInputSilent = () => {
        if (keyboardOpen) {
            hiddenInputRef.current?.focus();
        }
    };

    const handleClick = (button: 'left' | 'right') => {
        send({ type: 'click', button, press: true });
        setTimeout(() => send({ type: 'click', button, press: false }), 50);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const key = e.key.toLowerCase();

        if (modifier !== "Release") {
            if (key === 'backspace') {
                e.preventDefault();
                setBuffer(prev => prev.slice(0, -1));
                return;
            }
            if (key === 'escape') {
                e.preventDefault();
                setModifier("Release");
                setBuffer([]);
                return;
            }
            if (key !== 'unidentified' && key.length > 1) {
                e.preventDefault();
                handleModifier(key);
            }
            return;
        }

        if (key === 'backspace') send({ type: 'key', key: 'backspace' });
        else if (key === 'enter') send({ type: 'key', key: 'enter' });
        else if (key !== 'unidentified' && key.length > 1) {
            send({ type: 'key', key });
        }
    };

    const handleModifierState = () => {
        switch (modifier) {
            case "Active":
                if (buffer.length > 0) {
                    setModifier("Hold");
                } else {
                    setModifier("Release");
                }
                break;
            case "Hold":
                setModifier("Release");
                setBuffer([]);
                break;
            case "Release":
                setModifier("Active");
                setBuffer([]);
                break;
        }
    };

    const handleModifier = (key: string) => {
        if (modifier === "Hold") {
            const comboKeys = [...buffer, key];
            sendCombo(comboKeys);
            return;
        } else if (modifier === "Active") {
            setBuffer(prev => [...prev, key]);
            return;
        }
    };

    const sendText = (val: string) => {
        if (!val) return;
        const toSend = val.length > 1 ? `${val} ` : val;
        send({ type: 'text', text: toSend });
    };

    const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (isComposingRef.current) return;
        const val = e.target.value;
        if (val) {
            e.target.value = '';
            if (modifier !== "Release") {
                handleModifier(val);
            } else {
                sendText(val);
            }
        }
    };

    const handleCompositionStart = () => {
        isComposingRef.current = true;
    };

    const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
        isComposingRef.current = false;
        const val = (e.target as HTMLInputElement).value;
        if (val) {
            if (modifier !== "Release") {
                handleModifier(val);
            } else {
                sendText(val);
            }
            (e.target as HTMLInputElement).value = '';
        }
    };

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                position: "fixed",
                inset: 0,
                background: "#0d0d0f",
                overflow: "hidden",
            }}
        >
            {/* TOUCH AREA — takes all remaining space */}
            <div style={{
                flex: 1,
                minHeight: 0,
                position: "relative",
                display: "flex",
                flexDirection: "column",
                borderBottom: "1px solid #2a2d40",
            }}>
                <TouchArea
                    isTracking={isTracking}
                    scrollMode={scrollMode}
                    handlers={handlers}
                    status={status}
                />
                {bufferText !== "" && (
                    <div style={{
                        position: "absolute",
                        bottom: 16,
                        left: 0,
                        right: 0,
                        padding: "0 16px",
                    }}>
                        <BufferBar bufferText={bufferText} />
                    </div>
                )}
            </div>

            {/* CONTROL BAR */}
            <div style={{ flexShrink: 0, borderBottom: "1px solid #2a2d40" }}>
                <ControlBar
                    scrollMode={scrollMode}
                    modifier={modifier}
                    buffer={bufferText}
                    keyboardOpen={keyboardOpen}
                    extraKeysVisible={extraKeysVisible}
                    onToggleScroll={() => setScrollMode(!scrollMode)}
                    onLeftClick={() => handleClick('left')}
                    onRightClick={() => handleClick('right')}
                    onKeyboardToggle={toggleKeyboard}
                    onModifierToggle={handleModifierState}
                    onExtraKeysToggle={() => setExtraKeysVisible(prev => !prev)}
                />
            </div>

            {/*
              EXTRA KEYS — collapses when hidden or keyboard is open.
              Always mounted for smooth height transition.
            */}
            {/* EXTRA KEYS */}
            <div
                style={{
                    flexShrink: 0,
                    maxHeight: (!extraKeysVisible || keyboardOpen) ? "0px" : "50vh",
                    overflow: "hidden",
                    transition: "max-height 0.3s ease, opacity 0.2s ease",
                    opacity: (!extraKeysVisible || keyboardOpen) ? 0 : 1,
                    pointerEvents: (!extraKeysVisible || keyboardOpen) ? "none" : "auto",
                }}
            >
                <ExtraKeys
                    sendKey={(k) => {
                        if (modifier !== "Release") handleModifier(k);
                        else send({ type: 'key', key: k });
                    }}
                    onInputFocus={focusInputSilent}
                />
            </div>

            {/* HIDDEN INPUT — focused when keyboard is open, works for both mobile (native keyboard) and laptop (physical keyboard) */}
            <input
                ref={hiddenInputRef}
                style={{
                    opacity: 0,
                    position: "absolute",
                    bottom: 0,
                    pointerEvents: "none",
                    height: 0,
                    width: 0,
                }}
                onKeyDown={handleKeyDown}
                onChange={handleInput}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
            />
        </div>
    );
}
