# Adaptive voice language correction

Removed conflicting 'Converse naturally in ${language}' constraint. Added default Auto mode; IT/BN/EN are initial fallbacks, not locks. Explicit spoken language requests and latest full utterance drive response language. Borrowed words, UI language, source text and prior assistant response do not force language switches. No transcript-language or script-based lock introduced.

Raised server-VAD silence duration to 900ms (from provider default) to reduce responses during short within-sentence pauses; automatic responses and barge-in stay enabled. This does not eliminate all fragmented turns. Adjusted voice-footer stacking so short-desktop start controls remain clickable; no redesign or backend capability changes beyond voice policy.

Tests:
- New route test failed before: auto schema rejected; verifies outbound actual session configuration for all four language hints, adaptive policy and original safety/capability boundaries. Pass after.
- Real WebRTC native-language TTS sent via audio MediaStream (48kHz WebAudio -> peer audio sender), sequential Italian → Bangla → English in same session, waiting for completed response and playback-stop each time.
- Two post-fix runs, Auto and IT preference: 6/6 turns returned corresponding language, no provider error events. Bangla captions contain Bengali script; content reviewed manually. Some Bangla wording awkward, no native-pronunciation certification.
- Baseline with these clear audio fixtures also switched; therefore universal failure reported by user was not reproduced. The conflicting policy and missing Auto mode were concrete defects; do not invent baseline semantic failures.
- First fixture harness stopped supplying silence between clips, causing no end-of-speech event. Continuous zero-gain oscillator keeps transport active; corrected fixture provides valid before/after comparison. No audio/user transcript data from real users was read.
- Full suite 113/113, typecheck/syntax/whitespace pass, public static hashes match. Only new trial service restarted; no prior products changed.

User should end the prior voice connection, reload, leave Auto selected, and start a new session. Existing sessions retain old provider instructions. Test limits: synthetic speech, no real human accent/noisy-device validation.
