// Puts key in map as the most recently used, then lets go of the least
// recently used until only keep are left. A Map iterates in the order keys
// went in, so the first one is the oldest.
function keepRecent<K, V>(map: Map<K, V>, key: K, value: V, keep: number): void {
	map.delete(key);
	map.set(key, value);
	while (map.size > keep) map.delete(map.keys().next().value as K);
}

export { keepRecent };
