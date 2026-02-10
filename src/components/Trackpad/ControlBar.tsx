import React from "react";

export type ModifierState = "Active" | "Release" | "Hold";

interface ControlBarProps {
	scrollMode: boolean;
	modifier: ModifierState;
	onToggleScroll: () => void;
	onLeftClick: () => void;
	onRightClick: () => void;
	onKeyboardToggle: () => void;
	onModifierToggle: () => void;
}

export const ControlBar: React.FC<ControlBarProps> = ({
	scrollMode,
	modifier,
	onToggleScroll,
	onLeftClick,
	onRightClick,
	onKeyboardToggle,
	onModifierToggle,
}) => {
	const handleInteraction = (e: React.PointerEvent, action: () => void) => {
		e.preventDefault();
		action();
	};

	const getModifierButtonClass = () => {
		switch(modifier) {
			case "Active":
				return "btn-warning"; 
			case "Hold":
				return "btn-success";
			case "Release":
			default:
				return "btn-secondary";
		}
	};

	const getModifierLabel = () => {
		switch(modifier) {
			case "Active":
				return "Mod: +Key";
			case "Hold":
				return "Mod: Send";
			case "Release":
			default:
				return "Modifier";
		}
	};

	return (
		<div className="bg-base-200 p-2 grid grid-cols-5 gap-2 shrink-0">
			<button
				className={`btn btn-sm ${scrollMode ? "btn-primary" : "btn-outline"}`}
				onPointerDown={(e) => handleInteraction(e, onToggleScroll)}
			>
				{scrollMode ? "Scroll" : "Cursor"}
			</button>
			<button
				className="btn btn-sm btn-outline"
				onPointerDown={(e) => handleInteraction(e, onLeftClick)}
			>
				L-Click
			</button>
			<button
				className="btn btn-sm btn-outline"
				onPointerDown={(e) => handleInteraction(e, onRightClick)}
			>
				R-Click
			</button>
			<button
				className="btn btn-sm btn-secondary"
				onPointerDown={(e) => handleInteraction(e, onKeyboardToggle)}
			>
				Keyboard
			</button>
			<button
				className={`btn btn-sm ${getModifierButtonClass()}`}
				onPointerDown={(e) => handleInteraction(e, onModifierToggle)}
			>
				{getModifierLabel()}
			</button>
		</div>
	);
};