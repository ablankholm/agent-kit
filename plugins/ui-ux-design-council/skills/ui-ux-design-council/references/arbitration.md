# Arbitration: judging proposals and resolving disagreements

## Precedence order (when seats disagree)

Apply top-down and name the rule that decided each conflict.

1. **User's explicit goals and constraints** (the agreed brief).
2. **Accessibility** (WCAG 2.1 AA minimum): contrast, focus, keyboard, semantics, motion sensitivity. Not negotiable on any surface.
3. **Usability on core tasks** (Nielsen seat, plus ss-audit / review-ux-ui when in play). On the brief's top tasks, efficiency and clarity beat expressiveness.
4. **Repo design system** (load-bearing tokens and components from Step 1). Existing patterns beat catalog or native suggestions unless the brief is explicitly a rebrand or new system.
5. **Craft and anti-slop** (impeccable detectors and critique).
6. **Aesthetic direction** (native builder's thesis, ui-ux-pro-max catalog picks). Free to lead on expressive surfaces (landing, empty states, onboarding moments) as long as rules 1 to 5 hold.

Common conflicts and how to resolve them:

- **ui-ux-pro-max palette vs. existing tokens:** tokens win (rule 4). Borrow the catalog's *discipline* (accent ratio, neutrals) and map it onto the existing tokens.
- **Native builder's bold layout vs. Nielsen "consistency and standards":** bold wins on expressive surfaces; standards win on core task screens (rule 3).
- **impeccable "distill" vs. a feature the brief requires:** the brief wins (rule 1). Distill presentation, not capability; use progressive disclosure.
- **Two audits disagree on severity:** take the higher severity if the issue is on a core task, the lower one otherwise.

## Scoring rubric (Step 5)

Score each proposal 1 to 5 per row; weights in brackets.

| Criterion | What 5 looks like |
|---|---|
| Brief fit [×3] | Directly serves the top-ranked tasks; trade-offs resolved the way the brief intends |
| Usability [×3] | No critical or major Nielsen violations; all states designed |
| Accessibility [×2] | Meets AA by design, not as an afterthought |
| Repo consistency [×2] | Reuses load-bearing tokens/components; new ones justified |
| Distinctiveness [×1] | Clearly this product, would not be mistaken for a template |
| Feasibility [×1] | Buildable in the stack without heroics |

Show the scores, but don't let the arithmetic overrule judgment. Explain any recommendation that isn't the top scorer.

## Slop checklist

Flag these unless the brief or repo actually calls for them:

- Inter / Roboto / Arial / system-ui as the only typeface with no hierarchy reasoning
- Purple-to-blue or indigo gradients; gradient text in headings
- Centered hero + three icon-feature cards + CTA band, as a default
- `rounded-2xl` + soft drop shadow on every container; cards nested in cards
- Emoji used as icons; generic icon soup
- Grey-on-white everywhere with no deliberate accent use
- Uniform spacing with no rhythm; everything centered
- Glassmorphism or blur with no purpose
- Lorem ipsum or perfect-length placeholder content
- Only the happy path: no empty, loading, error or overflow states
- Decorative motion on every element; motion without `prefers-reduced-motion`
- Dashboards made of identical KPI cards with sparklines that don't answer a question

## Direction comparison template

Use one column per direction; the number of columns follows the direction count chosen in Step 4. If you used a matrix, add a row giving each direction's axis values.

```
Direction count: N: why: <constrained / single trade-off / default / multi-axis matrix>
Axes (if matrix): <axis1: opts> × <axis2: opts> … → combinations kept: …

| | D1: <name> (seat) | D2: <name> (seat) | … |
|---|---|---|---|
| Axis values | | | |
| Thesis | | | |
| IA / layout | | | |
| Trade-offs favored | | | |
| Nielsen issues (sev) | | | |
| Slop flags | | | |
| Weighted score | | | |
| Haft Pareto (if used) | | | |
| Steal for merge | | | |
```

With OpenSpec, this table goes in the change's `design.md`.
