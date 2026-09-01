# Isochords TODO

Done: MIDI file loading, and a score viewer synced to playback (staff notation
under the grid with a cursor on the sounding beat), echoing how the paper's
Figure 12 lines a grand staff up against the visualization.

Wanted but unavailable so far:

- **Bach, Cello Suite No. 1 Prelude (BWV 1007).** Interesting precisely because it
  is a single line implying harmony, so the grid would show arpeggiated chords
  assembling rather than landing at once. No machine-readable public-domain
  edition found in the music21 corpus or the MusicXML repositories reachable here.
- **Strauss, Also sprach Zarathustra (opening).** Public domain (1896) and the
  ideal demo — the sunrise alternates C major and C minor, which on the Tonnetz is
  an up-triangle and a down-triangle sharing an edge. Only PDF scans are findable,
  no symbolic score, so it would have to be hand-encoded as a labelled harmonic
  reduction rather than a real edition.
- Anything post-1930 (Take Five, La Vie en Rose, The Girl from Ipanema) is still
  in copyright and cannot be shipped as note data.
- Virtual on-screen/keyboard-mapped piano so users can play chords live instead of
  only picking from presets. The paper floats this too: "Some viewers have related
  desire to create music on the Isochords grid rather than just watch it."
- Live microphone pitch/chord detection. The original read MIDI events directly
  rather than analysing audio, so this would go beyond the paper.
- Per-instrument colouring, to "notate the path a single instrument or voice takes
  along the grid" (§6) — the paper's own suggested future work.

Deliberately not done, to stay faithful to the paper: mapping MIDI velocity to
circle brightness. §1.2 and the §4.1 heading promise "dynamics", but the only
mechanism §4.1 actually describes is transparent circles accumulating when several
octaves of one tone class sound at once, which is implemented.
