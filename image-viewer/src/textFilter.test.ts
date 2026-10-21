import { describe, expect, it } from 'vitest'
import { NAME_MAX, censorText, isClean, nameProblem, tidyName } from './textFilter'

describe('nameProblem', () => {
  it.each(['Ewan', 'Dr Smith', "O'Neill", 'Anne-Marie', 'lab_tech.2', 'Zoë', 'José', '李明', 'Ахмед'])(
    'lets %s through',
    (name) => expect(nameProblem(name)).toBeNull(),
  )

  it.each(['Scunthorpe', 'Cassandra', 'Dickens', 'Sussex Lab', 'Assistant', 'Hancock', 'Shiitake', 'Shitake'])(
    'does not flag %s, which only looks rude',
    (name) => expect(nameProblem(name)).toBeNull(),
  )

  it.each(['Ana L Smith', 'A B Smith', 'J.R. Hart', 'Mo S Hit'])('does not join up initials in %s', (name) =>
    expect(nameProblem(name)).toBeNull(),
  )

  it.each([
    'fuck',
    'Big Shit',
    'fuuuuck',
    'sh1t',
    'f u c k',
    'f.u.c.k',
    's-h-i-t man',
    'FUCK',
    'cunt',
    'b1tch',
    'ｆｕｃｋ',
  ])('turns down %s', (name) => expect(nameProblem(name)).toBe('Pick a different name'))

  it.each(['Dick', 'Dick Turpin', 'Philip K Dick', "Dick O'Brien"])('lets the name Dick through in %s', (name) =>
    expect(nameProblem(name)).toBeNull()
  )

  it.each(['Dickhead', 'dickface', 'd1ck', 'Dick fuck'])('still turns down %s', (name) =>
    expect(nameProblem(name)).toBe('Pick a different name')
  )

  // The price of letting the name through - there's no telling them apart.
  it('lets "Big Dick" through as well, since Dick is a whole word there', () => {
    expect(nameProblem('Big Dick')).toBeNull()
  })

  it('still flags dick outside names', () => {
    expect(isClean('what a dick')).toBe(false)
  })

  it('turns down names that are too short or too long', () => {
    expect(nameProblem('a')).toMatch(/At least/)
    expect(nameProblem('   a   ')).toMatch(/At least/)
    expect(nameProblem('x'.repeat(NAME_MAX))).toBeNull()
    expect(nameProblem('x'.repeat(NAME_MAX + 1))).toMatch(/At most/)
  })

  it.each(['<script>', 'a;DROP TABLE', 'name​hidden', '😀😀', 'tab\there?', 'a/b'])(
    'turns down symbols and hidden characters in %j',
    (name) => expect(nameProblem(name)).toMatch(/only/),
  )

  it('needs a letter or number, not just punctuation', () => {
    expect(nameProblem("--'.")).toMatch(/at least one/)
  })
})

describe('tidyName', () => {
  it('trims and collapses spaces', () => {
    expect(tidyName('  Dr   Smith \n')).toBe('Dr Smith')
  })

  it('puts accents into one form, so the length is what it looks like', () => {
    expect(tidyName('Zoë')).toBe('Zoë')
  })
})

describe('isClean and censorText', () => {
  it('leaves clean text alone', () => {
    const text = 'Tumour edge, check with the lab'
    expect(isClean(text)).toBe(true)
    expect(censorText(text)).toBe(text)
  })

  it('hides the rude word and keeps the rest', () => {
    const out = censorText('what the fuck is this')
    expect(isClean('what the fuck is this')).toBe(false)
    expect(out.startsWith('what the ')).toBe(true)
    expect(out.endsWith(' is this')).toBe(true)
    expect(out).not.toMatch(/fuck/i)
  })
})
