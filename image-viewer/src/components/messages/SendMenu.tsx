import { useCollectionContext } from "../../context/CollectionContext";
import { useRealtimeContext } from "../../context/RealtimeContext";
import type { Staged } from "./messages";

interface SendMenuProps {
	// Sending this session's invite in its own chat would be asking people who
	// are already in it.
	offerInvite: boolean;
	onPick: (staged: Staged) => void;
	onClose: () => void;
}

// Only what has no Saved tab of its own to be sent from - annotations, cell
// counts, their groups and collections have a Send button where they live.
function SendMenu({ offerInvite, onPick, onClose }: SendMenuProps) {
	const { session } = useCollectionContext();
	const { currentViewport } = useRealtimeContext();
	const hosting = !!session && !session.ended && session.myRole === "owner";
	const chosen = (staged: Staged) => {
		onPick(staged);
		onClose();
	};

	return (
		<div className="messages-send-menu" role="menu" aria-label="Attach">
			{/* Where you are now, not when it goes - you may move to write the message. */}
			<button
				type="button"
				role="menuitem"
				className="messages-send-item"
				onClick={() => {
					const area = currentViewport();
					if (area) chosen({ label: "The area you're looking at", area });
				}}
			>
				The area you're looking at
			</button>
			{offerInvite && hosting && (
				<button
					type="button"
					role="menuitem"
					className="messages-send-item"
					onClick={() => chosen({ label: `Invite to ${session.collectionName}`, invite: true })}
				>
					An invite to your session
				</button>
			)}
			<p className="messages-send-from">Anything else is sent with Send, where it's saved.</p>
		</div>
	);
}

export default SendMenu;
