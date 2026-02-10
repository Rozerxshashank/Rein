import { ModifierState } from "@/types";
import React from "react";

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
				return "btn-success"; 
			case "Hold":
				return "btn-warning";
			case "Release":
			default:
				return "btn-secondary";
		}
	};

	const getModifierLabel = () => {
		switch(modifier) {
			case "Active":
				return "Press";
			case "Hold":
				return "Release";
			case "Release":
			default:
				return "Hold";
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