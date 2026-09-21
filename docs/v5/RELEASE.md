# Release process

Target: existing GitHub Pages repository huangyuduoduo-afk/chop-chop. No new host, account system or public data store.

Local run: `python3 -m http.server 5185 --bind 127.0.0.1 --directory work/chop-chop-v3-production` from the workspace root. Open http://127.0.0.1:5185. Static files, no build step required. Test script lives at docs/v5/verify.cjs; its tool path is environment-specific.

Publish assets, docs and existing v3-preview entry atomically first; smoke-test that deployed entry in an isolated browser. Then update the existing production index.html to the validated version. Resolve latest remote blob/head before updating; never force-push the stale historical local checkout.

Deployment status and actual commit IDs are appended after publication, not assumed in advance.

Rollback safety: code baseline is docs/v5/baseline/index-4.5.8.html. Do NOT simply restore that page with automatic writes enabled once 5.0 content exists. First download complete backup on both devices. Keep new assets/data intact; recovery.html provides same-origin read-only access without cloud writes. Repair forward or use a read-only landing page while inspecting the retained snapshots.

Actual user's local snapshot and live cross-device backup have NOT been verified. No user browser data was cleared. Synthetic test data stays on localhost and is not shipped as application seed data.
