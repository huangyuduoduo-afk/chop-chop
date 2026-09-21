# 5.0 design decisions

Reference: the supplied confirmed visual board, original avatar and rounded wordmark image. Package SHA256 checks passed before work. No screenshot elements were cut out into fake UI. The original avatar is an unchanged independent JPEG. Ten original line SVG icons share 24px viewboxes, rounded strokes and pastel tiles; unknown keys fall back to a star.

Blue-white paper, dark slate body text, restrained pink/mint/yellow icons. Brand keeps the existing Baloo 2 face and orange punctuation. All other typography uses system sans-serif; obsolete remote handwriting font downloads were removed. Primary white-on-blue buttons use #4f76a2; normal body uses #34445c. Responsive widths tested: 320, 375, 390, 430, 1280, 1440. Main scrolling region reserves separate room for navigation, not merely padding beneath obscured buttons.

One existing bottom navigation, adding only 消息盒子. 记录 becomes 说说; 今天、目标、瓶子 remain. All old controls remain available. Today’s main item gets a full text row on narrow screens, with secondary relationship controls below. The avatar breathes over seven seconds and stops when editing, offscreen, hidden, motion is disabled or reduced motion is requested.

## Tool/source audit

Hallmark, Open Design and UI/UX Pro Max were not installed in the supplied skill catalog. Read-only inspection of their public project documentation; no global installation, external design upload or paid service:

- https://github.com/Nutlope/hallmark — use screenshot inspection and audit mindset; do not replace the user-approved style with a preset theme.
- https://github.com/nexu-io/open-design — keep project-local design rules and real editable files; do not introduce its separate desktop platform or another framework.
- https://github.com/nextlevelbuilder/ui-ux-pro-max-skill — use responsive, readable, keyboard-accessible component checks; do not apply a SaaS dashboard template.

The installed agent-browser / verification skills supplied the actual browser-test workflow. agent-browser 0.38.1 runs isolated Chrome against localhost. Screenshots are captured after transition completion, using synthetic records. Voice-state screenshots, if present, are explicitly simulated, not microphone evidence.
