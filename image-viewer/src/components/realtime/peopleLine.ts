// How many names a list of people shows before the rest become a count.
const SHOWN = 4

// "Bob Hughes, Carol Singh, Edward Elric, Winry Rockbell +64 others" - a
// few names, in the order given (the host first), and how many more. All
// of them when there's no more than SHOWN + 1, since "+1 other" saves
// nothing over the name.
function peopleLine(names: string[], shown = SHOWN): string {
  if (names.length <= shown + 1) return names.join(', ')
  const more = names.length - shown
  return `${names.slice(0, shown).join(', ')} +${more.toLocaleString('en-GB')} others`
}

export { peopleLine }
