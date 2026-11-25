import { useRealtimeContext } from "../../context/RealtimeContext";
import { putInDoc, type PutTextTransport, type TextBack } from "./putText";

// Puts an old label and notes into a row's form for everyone who has it open.
function usePutText(): (back: TextBack) => Promise<void> {
	const { openDoc, sendDocUpdate, closeDoc, openFields } = useRealtimeContext();
	const transport: PutTextTransport = { openDoc, sendDocUpdate, closeDoc, openFields };
	return (back) => putInDoc(transport, back);
}

export { usePutText };
