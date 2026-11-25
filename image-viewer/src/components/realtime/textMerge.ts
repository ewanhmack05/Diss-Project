// A piece of text taken out of, and put into, a longer one.
interface Splice {
	index: number;
	remove: number;
	insert: string;
}

// For each character of `from`, where it is in `to`, or -1 - as many of them as
// can be, in order.
function pairUp(from: string, to: string): number[] {
	const best = Array.from({ length: from.length + 1 }, () => new Uint16Array(to.length + 1));
	for (let i = from.length - 1; i >= 0; i--)
		for (let j = to.length - 1; j >= 0; j--)
			best[i][j] = from[i] === to[j] ? best[i + 1][j + 1] + 1 : Math.max(best[i + 1][j], best[i][j + 1]);
	const pairs = new Array<number>(from.length).fill(-1);
	for (let i = 0, j = 0; i < from.length && j < to.length; ) {
		if (from[i] === to[j]) pairs[i++] = j++;
		else if (best[i + 1][j] >= best[i][j + 1]) i++;
		else j++;
	}
	return pairs;
}

// The edit that turned `from` into `to`, made to `live` - another edit of the
// same text - without taking out anything that isn't in `from`. Last splice
// first, so each one's index is still right when the ones before it are done.
function sameEdit(from: string, to: string, live: string): Splice[] {
	const kept = pairUp(from, to);
	const where = pairUp(from, live);
	const splices: Splice[] = [];
	let [after, done] = [0, 0];
	const put = (upTo: number) => {
		if (upTo > done) splices.push({ index: after, remove: 0, insert: to.slice(done, upTo) });
	};
	for (let i = 0; i < from.length; i++) {
		if (kept[i] >= 0) {
			put(kept[i]);
			done = kept[i] + 1;
		} else if (where[i] >= 0) splices.push({ index: where[i], remove: 1, insert: "" });
		if (where[i] >= 0) after = where[i] + 1;
	}
	put(to.length);
	return splices.reverse();
}

function spliced(text: string, splices: Splice[]): string {
	return splices.reduce((now, { index, remove, insert }) => now.slice(0, index) + insert + now.slice(index + remove), text);
}

export { sameEdit, spliced };
export type { Splice };
