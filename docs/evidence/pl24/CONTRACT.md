# Source position contract

`ReaderRequest.sourceId` is an optional opaque ID generated for one source extraction.
It survives validation and is echoed as `ReaderSnapshot.sourceId`. Existing `sessionId`
identifies playback. A new extraction gets a new source ID even if its text repeats.
The accepted ID grammar is `[A-Za-z0-9-]{1,100}`; invalid values are discarded.

`spokenPosition` is either `{precision:'unavailable'}` or
`{precision:'sentence'|'chunk', start:number, end:number}`. Offsets use UTF-16 code units
in the **exact normalized request text**, with an exclusive end. They are separate from
`elapsedSec`, the browser media transport position. Sentence IDs `s:<start>:<end>` are
stable within a source. For a selection, offset zero is its normalized beginning, not
the beginning of the article; a partial first/last sentence highlights only selected text.
Text nodes and DOM ranges stay in the content script and are never serialized.

Native Start Speaking initially uses `unavailable`; lifecycle timestamps do not supply
source boundaries. Kokoro maps cumulative appended PCM sample durations to media
`currentTime`. Sentence-aligned chunks allow a full sentence to remain highlighted across
several smaller synthesis chunks. This is sentence/segment timing, not phoneme alignment
or an acoustic loopback clock. A multi-sentence cue is explicitly `chunk` precision.

Pause retains the indicated sentence; seek/replay/resume use the media clock. Preparing,
buffering, completion, Stop, errors and close remove the visible highlight. Close/Stop,
session replacement and navigation also release source mappings. Completion keeps source
mapping only for supported replay (a Kokoro replay deadline or native source replay).
The background's idle/Stop snapshot carries the **released** session/source IDs and its
page delivery is awaited before a replacement capture. Consumers ignore an idle snapshot
from another session or without the active session ID. Stale session/source messages
cannot revive or clear a replacement highlight. Capture/show explicitly binds the new
session; normal new-session playback snapshots remain accepted by the player client.

PL-24 owns this additive protocol, source extraction and Kokoro position mapping. PL-23
owns native capability/control/UI changes and can emit native source positions only to
the measured capability. The player detail copy helper is `highlightDescription`.
