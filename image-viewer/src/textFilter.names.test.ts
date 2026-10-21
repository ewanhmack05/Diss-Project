import { describe, expect, it } from 'vitest'
import { nameProblem } from './textFilter'

// Real surnames, first names and places with a rude word somewhere inside.
// Every one has to get through. A new false positive goes here first, then
// into REAL_NAMES in textFilter.ts.
const REAL = [
  'Cockburn',
  'Hitchcock',
  'Butts',
  'Wankel',
  'Dickinson',
  'Dickson',
  'Dickens',
  'Dick',
  'Cumming',
  'Cummings',
  'Cumberbatch',
  'Shitole',
  'Kuntz',
  'Fuchs',
  'Fukuda',
  'Fukushima',
  'Phuc',
  'Bitchell',
  'Assange',
  'Glasscock',
  'Babcock',
  'Hancock',
  'Peacock',
  'Woodcock',
  'Analise',
  'Annalise',
  'Hoare',
  'Gaylord',
  'Lipschitz',
  'Sexton',
  'Titus',
  'Fanny',
  'Willy',
  'Wang',
  'Cox',
  'Pratt',
  'Bumstead',
  'Dong',
  'Nobbs',
  'Slaughter',
  'Kock',
  'Assis',
  'Assad',
  'Hassan',
  'Cassidy',
  'Clitheroe',
  'Penistone',
  'Scunthorpe',
  'Rapeseed',
  'Matthew Dickinson',
  'Dr Cumming',
]

// Over-blocks left in on purpose - they're rude as often as they're names.
const STILL_BLOCKED = ['Tit', 'Twatt']

describe('real names with rude words inside', () => {
  it.each(REAL)('lets %s through', (name) => expect(nameProblem(name)).toBeNull())

  it.each(STILL_BLOCKED)('still turns down %s', (name) => expect(nameProblem(name)).not.toBeNull())

  it('allowing a real name does not let the word on its own through', () => {
    expect(nameProblem('cum')).not.toBeNull()
    expect(nameProblem('Dickinson cunt')).not.toBeNull()
    expect(nameProblem('penis')).not.toBeNull()
    expect(nameProblem('rape')).not.toBeNull()
  })
})
