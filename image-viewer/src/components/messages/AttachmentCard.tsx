import { useEffect, useRef, useState } from "react";
import { useImageViewerContext } from "../../context/ImageViewerContext";
import { useMessagingContext } from "../../context/MessagingContext";
import { useToastContext } from "../../context/ToastContext";
import { formatShortDate } from "../saved/savedDates";
import AreaPreview from "./AreaPreview";
import type { ShownArea } from "./sentArea";
import { useInviteGate } from "../realtime/InviteGate";
import { attachmentNoun, formatBytes, type Attachment, type Message } from "./messages";
import { useSentThings } from "./useSentThings";

// Over this it takes asking, rather than downloading megabytes for a thumbnail
// on just scrolling past.
const PREVIEW_WITHOUT_ASKING_BYTES = 1024 * 1024;

interface AttachmentCardProps {
	message: Message;
	attachment: Attachment;
	// You sent it, so it's yours already - adding it would only be a duplicate.
	mine: boolean;
	onChanged: (attachment: Attachment) => void;
	// Its preview's arrived, so it's taller than it was.
	onGrew: () => void;
}

// Something sent in a message: what it is, and adding it to your own collection
// as a copy. An invite opens the same preview as a link, which already says if
// it's stopped, run out or for another slide.
function AttachmentCard({ message, attachment, mine, onChanged, onGrew }: AttachmentCardProps) {
	const { addToMine, shownFor, viewOnMap } = useSentThings();
	const { shownArea, showArea } = useMessagingContext();
	const { openInvite } = useInviteGate();
	const { source } = useImageViewerContext();
	const { addToast } = useToastContext();
	const [adding, setAdding] = useState(false);
	const [viewing, setViewing] = useState(false);
	const [preview, setPreview] = useState<ShownArea | null>(null);
	const [previewAsked, setPreviewAsked] = useState(false);
	const cardRef = useRef<HTMLDivElement>(null);

	const previewable = attachment.kind !== "invite";
	const big = attachment.bytes > PREVIEW_WITHOUT_ASKING_BYTES;
	const wanted = previewable && (!big || previewAsked);

	// Only once it's scrolled into sight, since each one is a download.
	useEffect(() => {
		const card = cardRef.current;
		if (!wanted || !card) return;
		let stopped = false;
		const observer = new IntersectionObserver((entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			observer.disconnect();
			shownFor(message)
				.then((shown) => {
					if (!stopped) setPreview(shown);
				})
				.catch(() => {});
		});
		observer.observe(card);
		return () => {
			stopped = true;
			observer.disconnect();
		};
	}, [wanted, shownFor, message]);

	const elsewhere = !!attachment.slideId && attachment.slideId !== source.slideId;
	const add = () => {
		setAdding(true);
		addToMine(message)
			.then((updated) => {
				onChanged(updated);
				addToast(elsewhere ? `Added to your collection for slide ${attachment.slideId}` : "Added to your collection", "success");
			})
			.catch((error: Error) => addToast(error.message || "Couldn't add that - nothing was added", "error"))
			.finally(() => setAdding(false));
	};

	useEffect(() => {
		if (preview) onGrew();
	}, [preview, onGrew]);

	const showing = shownArea?.messageId === message.id;
	const view = () => {
		if (showing) {
			showArea(null);
			return;
		}
		setViewing(true);
		viewOnMap(message)
			.catch((error: Error) => addToast(error.message || "Couldn't show that", "error"))
			.finally(() => setViewing(false));
	};

	return (
		<div ref={cardRef} className="messages-card">
			{preview && (
				<AreaPreview
					area={preview}
					slideId={attachment.slideId ?? source.slideId}
					label={`Preview of ${attachment.name}`}
					onOpen={elsewhere || showing ? undefined : view}
				/>
			)}
			<span className="messages-card-about">
				<span className="messages-card-kind">{attachmentNoun(attachment.kind)}</span>
				<span className="messages-card-name" title={attachment.name}>
					{attachment.name}
				</span>
				{attachment.kind === "invite" ? (
					attachment.inviteCode &&
					!mine && (
						<button type="button" className="messages-button messages-button--accent" onClick={() => openInvite(attachment.inviteCode!)}>
							Have a look
						</button>
					)
				) : (
					<>
						{attachment.kind !== "area" && <span className="messages-card-meta">{formatBytes(attachment.bytes)}</span>}
						{elsewhere && <span className="messages-card-meta">From slide {attachment.slideId}, so you can't see it from here</span>}
						{attachment.lastAddedByMe && <span className="messages-card-meta">Added {formatShortDate(attachment.lastAddedByMe)}</span>}
						<span className="messages-card-actions">
							{previewable && big && !previewAsked && (
								<button type="button" className="messages-button" onClick={() => setPreviewAsked(true)}>
									Preview
								</button>
							)}
							{!elsewhere && (
								<button type="button" className="messages-button" disabled={viewing} aria-pressed={showing} onClick={view}>
									{viewing ? "Finding…" : showing ? "Stop showing" : "View"}
								</button>
							)}
							{!mine && attachment.kind !== "area" && (
								<button type="button" className="messages-button messages-button--accent" disabled={adding} onClick={add}>
									{adding ? "Adding…" : attachment.lastAddedByMe ? "Add again" : "Add to my collection"}
								</button>
							)}
						</span>
					</>
				)}
			</span>
		</div>
	);
}

export default AttachmentCard;
