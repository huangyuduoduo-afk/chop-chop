# Release process

Target: existing GitHub Pages repository huangyuduoduo-afk/chop-chop. No new host, account system or public data store.

Local run: `python3 -m http.server 5185 --bind 127.0.0.1 --directory work/chop-chop-v3-production` from the workspace root. Open http://127.0.0.1:5185. Static files, no build step required. Test script lives at docs/v5/verify.cjs; its tool path is environment-specific.

Publish assets, docs and existing v3-preview entry atomically first; smoke-test that deployed entry in an isolated browser. Then update the existing production index.html to the validated version. Resolve latest remote blob/head before updating; never force-push the stale historical local checkout.

Deployment status and actual commit IDs are appended after publication, not assumed in advance.

## Published commits (2026-09-21)

- Preview/assets/docs: `1cb412f06443ea634389a6e93cdb945d8ab57c95`.
- Production entry: `35464577c7c6c0997c821dd1beaeecbbee0d83bc`, APP_VERSION `5.0.0`.
- Preview smoke: actual HTTPS page reported `5.0.0-preview`, loaded avatar, stylesheet and message box, and showed no runtime errors in an isolated Chrome session. No user token was used.
- Production runtime check: PASS. Isolated Chrome at the production URL reported `5.0.0`, all five navigation entries and a loaded avatar, with no runtime errors. The one synthetic idea/record saved in the preview remained exactly one idea/record at the production entry. This verifies same-browser continuity, not real-device Gist synchronization.

Production URL: https://huangyuduoduo-afk.github.io/chop-chop/?v=5.0.0
Preview URL: https://huangyuduoduo-afk.github.io/chop-chop/v3-preview/?v=5.0.0-preview

Rollback safety: code baseline is docs/v5/baseline/index-4.5.8.html. Do NOT simply restore that page with automatic writes enabled once 5.0 content exists. First download complete backup on both devices. Keep new assets/data intact; recovery.html provides same-origin read-only access without cloud writes. Repair forward or use a read-only landing page while inspecting the retained snapshots.

Actual user's local snapshot and live cross-device backup have NOT been verified. No user browser data was cleared. Synthetic test data stays on localhost and is not shipped as application seed data.
