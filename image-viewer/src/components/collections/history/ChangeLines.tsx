import Icon from "../../../icons/Icon";
import arrowSvg from "../../../icons/arrow-right.svg?raw";
import type { ChangeLine, Shown } from "./changes";

function Value({ shown }: { shown: Shown }) {
	return (
		<span className={`history-change-value${shown.empty ? " history-change-value--empty" : ""}`} title={shown.text}>
			{shown.colour && <span className="history-swatch" style={{ background: shown.colour }} />}
			{shown.text}
		</span>
	);
}

// A field's values, from and to. Without from, it's only what it will be -
// for something coming back that isn't there to change from.
function ChangeValues({ line, toOnly = false }: { line: ChangeLine; toOnly?: boolean }) {
	return (
		<div className={`history-change-values history-change-values--${line.kind}`}>
			{!toOnly && (
				<>
					<span className="history-change-froms">
						{line.from.map((from, j) => (
							<Value key={j} shown={from} />
						))}
					</span>
					<Icon svg={arrowSvg} size={12} className="history-change-arrow" />
				</>
			)}
			<Value shown={line.to} />
		</div>
	);
}

// One field a change changed, as a list item. rows is which rows, when the
// list doesn't say so once at the top.
function ChangeLineItem({ line, rows, toOnly }: { line: ChangeLine; rows?: string; toOnly?: boolean }) {
	return (
		<li className="history-change">
			<div className="history-change-head">
				<span className="history-change-field">{line.field}</span>
				{rows && <span className="history-change-rows">{rows}</span>}
			</div>
			<ChangeValues line={line} toOnly={toOnly} />
		</li>
	);
}

export default ChangeLineItem;
