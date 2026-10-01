# Modern voice-mode redesign

Implemented and published a full-screen, original NOVA voice surface inspired by the reference's focus and spaciousness without cloning its orb, branding, or exact control arrangement.

- Original asymmetric blue/teal ring visualization; reduced-motion disables all animation.
- Event-driven states: ready, connecting, listening, thinking, speaking, muted, error. No timer-simulated task state.
- Explicit start, mute/unmute, end-session and return-to-chat controls. Ending or returning stops microphone tracks and WebRTC; permission-resolution-after-close is fenced.
- Optional CC transcript view with `aria-pressed`, language selector, visible microphone/privacy scope, audio-playback recovery.
- Full-screen mobile and desktop layout; short-height and 320px-width checks; no visible clipping in final live screenshot.

Verification:
- RED against preserved prior UI; corrected assertions initially failed because old modal lacked full-screen/mute/captions controls.
- Controlled RTC UI: all corrected assertions pass, no console errors.
- Public Cloudflare with real Azure WebRTC: connected, provider speaking event drove UI, inbound audio bytes/packets observed, actual MediaStreamTrack muted, close released peer/stream, no page errors.
- Full project suite 112/112, typecheck and JS syntax pass.
- Public features.js/style.css bytes match local SHA-256 in verification.json.

Limit: browser test uses Chromium fake microphone; user must judge real phone microphone, pronunciation and naturalness. Voice remains deliberately separate/non-mutating and does not save transcript/documents. No commit and no old-product changes.
