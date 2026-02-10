import React from "react";

interface ControlBarProps {
	bufferText: String
}

export const BufferBar: React.FC<ControlBarProps> = ({bufferText}) => {
	return (
		<p>
			{bufferText}
		</p>
	);
};
