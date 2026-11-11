# Ethics

What would have to be answered before this system holds real data or is tried with
real people. None of it is being done for this project. It's left as future work, so
this is what the write up can point at, and what's true of the system today.

These are open questions. Nobody has been asked yet, and I haven't checked them against
NHS or data protection rules, so nothing here says what the rules require.

## Where it stands today

No real data and no real people, so none of this applies yet.

| What            | What's used now                                                                    |
| --------------- | ---------------------------------------------------------------------------------- |
| Slides          | [OpenSlide's public test data](../tiler/README.md#data)                            |
| Accounts        | Made up people on `example.test` addresses, in the [Keycloak realm](../auth/realm) |
| Playback videos | Made up people. Labels are made up and the dots don't mark real cells              |
| Evaluation      | Simulated, every number in [evaluation.md](evaluation.md)                          |
| Where it runs   | Locally. Nothing's deployed - see [azure.md](azure.md)                             |

## Ethical approval

Is NHS ethical approval needed? It should be asked early, as it takes a long time. There
are two separate questions in it:

- **Real data** - slides from real patients, and what people write about them
- **Real people** - anyone taking part in a study of the system, like a lab analyst
  trying it out

Testing with people depends on the answer, which is why the evaluation stays simulated.
It measures what the software does, and can't say how often conflicts happen in real
work or whether people find the tools any good.

Using work's data or a lab analyst's time are also open, in
[section 10 of the todo](todo.md#10-questions-to-ask-supervisor--work).

To my knowledge, NHS ethical approval shouldnt be needed, as the slide is fully anonymous by the time I get access to it.
Slide being used at the moment states `	Free to use and distribute, with or without modification` (https://openslide.cs.cmu.edu/download/openslide-testdata/Mirax/)

## What could be personal data

Today's test data is harmless, but the system would keep all of this for real.

| What                | Where it's kept                                                  | Why it matters                                                                     |
| ------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| The slide           | `tiler/data`                                                     | Slide files can have a scanned label with them, and the filename is the slide's id |
| Labels and notes    | Annotations and counts, and the history log                      | Free text. Someone can type a patient's details and nothing would stop them        |
| Messages            | messaging's database                                             | Free text as well, and it's normal to talk about a case in a message               |
| Sent copies         | Attachments on a message                                         | See [sent copies](#sent-copies)                                                    |
| People's names      | `CreatedByName`, `DisplayName`, `history.ChangeSets`, `FromName` | Copied in when the row's written, so they're separate from the account             |
| Who did what, when  | `history.ChangeSets`                                             | A record of a person's work. It could be read as a measure of them                 |
| Guests' typed names | The hub's memory only                                            | See [guests' names](#guests-names)                                                 |

Two things about slides would need sorting out before a real one goes in. The tiler
never asks OpenSlide for a slide's label image, so the viewer can't show it, but it's
still in the file. And `SlideCatalog` uses the filename as the id, which then goes into
URLs and saved rows, so a filename with a case number in it would spread everywhere. Real
slides would have to be de-identified and renamed first.

Who did what is the one that's easy to miss. History exists so people can see who
changed what, which is the point of the project, but anyone using it for real should be
told it's there and what it's for.

## Sent copies

Sending copies the rows into the message, up to 5MB, so what's sent still works when
the original changes. See [messaging.md](messaging.md#decisions). That's a deliberate
choice, and it has a cost:

- A sent copy outlives losing access to the original. Someone taken off a collection
  still has what they were sent
- Deleting the original doesn't touch the copy
- Notes and shapes may describe patient slides, so this could be patient data sitting
  outside the collection that was meant to control who sees it

It's fine on test data. Real data would need either a way to pull a copy back, or an
agreement that sending something is the same as sharing it for good.

## Guests' names

Guests type a name to join a session, and it could be a real one. The rule is that it's
never saved anywhere on the server. It sits in the hub's memory while they're connected
and goes to the others in the room, and that's it. See [guests.md](guests.md).

- It isn't in the token, and annotation-store never sees it
- Guests are view only and can't write a row, so nothing can carry it into one
- Logs have the guest id only, so that's already done, and messaging turns guests away
  with a 401

Saving these names would need ethical approval, which is why they aren't saved. What
the rule can't cover is the screen: other people in the session see the name, and can
write it down or screenshot it.

## Keeping history

There's no purge rule. Nothing's purged, so the log grows forever, and deleting
something doesn't get rid of it: the row goes from the live table, but its delete entry
holds all of it, notes and shapes included, so it can be put back.

That's what version control needs and it's the opposite of what privacy wants. A rule
has to settle:

- **How long entries are kept**, for a slide still being worked on and one that's finished
- **What a purge leaves behind.** Rollback
  [only goes backwards](breakdown/version-control.md#putting-a-whole-collection-back),
  from what's there now or a later snapshot, so entries older than the cut can go without
  breaking anything newer. Snapshots older than it have to go with them, as they hold
  notes and labels too. Nothing before the cut can be put back after that. That's how I'd
  try it first, but it's not built or tested
- **Whether some of it has to be kept.** If this were used on real cases, a record of who
  changed what might be required rather than optional. That's a question for whoever
  approves it, and it could pull against everything above

Some areas, especially in pathology require data to be kept for up to 30 years (the Royal College of Pathologists' [G031](https://www.rcpath.org/static/049ea966-df5c-4a9f-9353ba24a69bb808/bd7ed2ba-8e77-4a2d-8c3ae7e74f3aaaa0/g031-The-retention-and-storage-of-pathological-records-and-specimens.pdf), October 2025: 30 years for tissue blocks and lab records that are part of the patient's record, at least 8 for slides and digital images used for diagnosis). This is mostly slides and tissue samples, but data around these may also have to follow the same rules - not 100% sure

## Retention

The log keeps user ids and names indefinitely, and so do the rows themselves. Removing
someone from Keycloak doesn't change any of it: their rows and messages stay, under the
name they had then.

Messages have no time limit either:

| Kind         | Kept until                                                        |
| ------------ | ----------------------------------------------------------------- |
| One to one   | Both people have deleted it. One deleting only hides it from them |
| Session chat | The session's owner deletes it                                    |

So a rule needs a period for messages, and a way to take a person out when they ask or
leave. Blanking the names would be a start, but the rows would still have the user id,
which points at them for as long as Keycloak has them. How long the periods are would
come from whoever approves it.

## Label and notes history

Labels and notes are merged live with Yjs, but no earlier version is kept once the box
closes. So someone can change what a note says and the history can't show what it said
before, which matters if notes are part of the record.

Saving a version to the history log when the last editor closes it is the simple way,
and enough for a history view. Keeping the Yjs updates would also work but it's more
than a history view needs. Either way, it puts more free text in the log, so it comes
under the same purge and retention rules.

## Before any real data

In the order I'd do them:

1. Ask whether approval is needed, and get it if so
2. Agree where real slides come from, and de-identify and rename them first
3. Set the purge and retention rules, and build them
4. Decide what happens to sent copies when someone loses access
5. Add a way to take someone out of the names and messages
6. Tell people what's recorded about them, and for what
7. Work through "Before anything is public" in [azure.md](azure.md). Keycloak's realm
   also lets anyone register at the moment, which would have to be turned off
