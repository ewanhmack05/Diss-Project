import { RegExpMatcher, TextCensor, englishDataset, englishRecommendedTransformers } from 'obscenity'

// Real names and places the dataset blocks. Found by running surnames that
// trip filters through it - the list in textFilter.names.test.ts. The
// dataset has "shitake" but not "shiitake", which the stretched-word step
// squashes into "shitake" before the blacklist sees it.
const REAL_NAMES = [
  'shiitake',
  'analise',
  'annalise',
  'bitchell',
  'cumberbatch',
  'cumming',
  'dickinson',
  'dickson',
  'fukuda',
  'fukui',
  'fukushima',
  'penistone',
  'rapeseed',
  'shitole',
  'wankel',
]

// The recommended transformers catch leetspeak, lookalike letters and
// stretched words ("sh1t", "fuuuck"). The dataset's whitelist keeps the usual
// false positives like "Scunthorpe" and "assassin" out.
const dataset = englishDataset.build()
const matcher = new RegExpMatcher({
  ...dataset,
  whitelistedTerms: [...(dataset.whitelistedTerms ?? []), ...REAL_NAMES],
  ...englishRecommendedTransformers,
})
const censor = new TextCensor()

// "f u c k", "f.u.c.k" - three or more single letters with a gap between each.
// Only runs of single letters, so "Ana L Smith" doesn't become "analsmith".
const SPACED_LETTERS = /(?<![\p{L}\p{N}])\p{L}(?:[ ._-]\p{L}(?![\p{L}\p{N}])){2,}/gu

function closeUp(text: string): string {
  return text.replace(SPACED_LETTERS, (run) => run.replace(/[ ._-]/g, ''))
}

const NAME_MIN = 2
const NAME_MAX = 24
// Letters and numbers in any script, plus space, dash, underscore, full stop
// and apostrophe. Keeps out emoji, symbols and invisible characters.
const NAME_CHARS = /^[\p{L}\p{M}\p{N} ._'-]+$/u

// Names that are also swear words, let through in a name when they're a whole
// word - "Dick Turpin", but not "Dickhead". Not in REAL_NAMES, since that
// works on any part of a word and would let "dickhead" through too. Only for
// names - other text still flags them.
const NAME_WORDS = /(?<!\p{L})(?:dick)(?!\p{L})/giu

function tidyName(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ')
}

function isClean(text: string): boolean {
  return !matcher.hasMatch(text) && !matcher.hasMatch(closeUp(text))
}

function censorText(text: string): string {
  return censor.applyTo(text, matcher.getAllMatches(text))
}

// Null when the name is fine, otherwise what to tell the person.
function nameProblem(raw: string): string | null {
  const name = tidyName(raw)
  if (name.length < NAME_MIN) return `At least ${NAME_MIN} characters`
  if (name.length > NAME_MAX) return `At most ${NAME_MAX} characters`
  if (!NAME_CHARS.test(name)) return 'Letters, numbers, spaces and - _ . \' only'
  if (!/[\p{L}\p{N}]/u.test(name)) return 'Needs at least one letter or number'
  if (!isClean(name.replace(NAME_WORDS, '_'))) return 'Pick a different name'
  return null
}

export { NAME_MAX, NAME_MIN, censorText, isClean, nameProblem, tidyName }
