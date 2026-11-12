# UI/UX Design Council

A meta UI/UX design skill for Claude Code and Codex. It turns short goals into reasoned, repo-grounded interface design that doesn't look like default agent output. It does this by orchestrating specialist skills and making them compete:

| Seat | Skill | Role |
|---|---|---|
| Craft lead | [impeccable](https://github.com/pbakaus/impeccable) | Product/design context, anti-pattern detection, critique, polish |
| Usability judge | [nielsen-heuristics-audit](https://github.com/mastepanoski/claude-skills) | Nielsen's 10 heuristics, severity-ranked |
| Style catalog | [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | Styles, palettes, font pairings, UX guidelines |
| Native builder | An installed frontend skill, or the included fallback | Bold visual thesis, implementation |
| Optional | [review-ux-ui](https://github.com/pjt222/agent-almanac), [ss-audit](https://github.com/bitjaru/styleseed) | Flows + WCAG; mobile |

## What it does

1. **Preflight (cached per repo):** detects which sub-skills, OpenSpec and Haft/Quint are present. It offers install commands, with a repo-vs-global recommendation, for anything missing.
2. **Grounds in the repo:** inventories existing tokens, components and patterns.
3. **Intake:** asks only what it can't infer, in one batch with recommended defaults.
4. **Brief in your system of record:** an OpenSpec proposal, specs, design and tasks when the repo uses OpenSpec; Haft framing when present; otherwise a freeform brief.
5. **Competing directions:** three by default. It uses fewer for constrained work, or a morphological matrix when there are several independent design axes.
6. **Iteration loop:** builds variants as real code behind a dev-only switch, captures them under identical conditions, judges them (Nielsen, anti-slop, weighted rubric) and records lineage in `log.json`. It generates a comparison board with a score trend, regression flags, per-iteration grids, champion lineage and an A/B overlay.
7. **Finalizes** the champion, cleans up the losing variants, and reviews the result again.

## Install

The repo-level install commands are in the [repo README](../../README.md#install). After installing, ask for the skill by name (`ui-ux-design-council`), or describe a UI/UX task and let it trigger.

## Requirements

- `bash`, `python3` (3.9+). Node.js 18+ and Playwright in the target project for automated screenshots (optional; host browser tools work too).
- The specialist skills above are optional separate installations. The council offers to install missing seats and uses built-in fallbacks if you decline.

## Files

The paths below are relative to `skills/ui-ux-design-council/`.

- `SKILL.md`: the orchestration workflow
- `references/`: skill registry, intake, OpenSpec/Haft integration, arbitration rules, comparison method, fallbacks
- `scripts/detect_deps.sh`: cached dependency detection
- `scripts/capture.mjs`: parity screenshots via Playwright
- `scripts/build_board.py`: comparison board
- `assets/log.example.json`: example iteration log
