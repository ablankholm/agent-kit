# Intake: from a terse request to something designable

Goal: reach design-readiness with the fewest questions. The user's time is the scarce resource, so infer first, ask second, assume (out loud) third.

## 1. Infer before asking

Answer from the repo and conversation wherever you can:

| Question | Where to look |
|---|---|
| Who are the users? | `PRODUCT.md`, README, marketing copy, onboarding screens, auth roles, OpenSpec `config.yaml` context, existing specs |
| What do they do here? | Routes/pages, component names, analytics events, API endpoints the UI calls, tests (especially e2e) |
| What exists already? | The current screen (screenshot it), `DESIGN.md`, tokens, component library |
| Constraints? | Stack, CSS approach, i18n setup, a11y tooling, browser targets, design-system package |
| Prior decisions? | OpenSpec specs/changes, Haft/Quint decision records, ADRs, PR history on these files |

## 2. Design-readiness checklist

You're ready when each row is known, inferred with reasonable confidence, or explicitly assumed:

- [ ] **Users & jobs:** who, what outcome, how often (daily power use vs. occasional)
- [ ] **Core tasks:** the 1 to 3 things this UI must make easy, ranked
- [ ] **Scope:** which screens/flows are in and out; new vs. redesign; may existing patterns change?
- [ ] **Success criteria:** what "better" means (faster task, fewer errors, conversion, clarity, brand feel)
- [ ] **Constraints:** platform/breakpoints, accessibility level, content realities, deadlines
- [ ] **Trade-off stance:** where it sits on the 1 to 2 tensions that matter (density ↔ approachability, guidance ↔ speed, expressive ↔ consistent)

## 3. Ask one tight batch

- 2 to 5 questions, only for rows that are unknown **and** would change the design.
- Each question comes with a **recommended default and a one-line reason**, so the user can answer "yes" or "defaults".
- Prefer multiple choice. Use the host's structured question tool if available (Claude: AskUserQuestion); otherwise a numbered list.
- Lead with your understanding so the user can correct it rather than start from scratch:

> Here's what I've inferred: admins configuring org-wide settings, weekly use, the existing token system stays. Three things I can't tell from the repo:
> 1. **Primary goal?** a) find a setting fast (recommended: 40+ settings, search is cheap) b) guided setup c) audit what changed
> 2. **Can the left-nav pattern change?** a) no, extend it (recommended: used on 6 other pages) b) yes for this page
> 3. **Mobile?** a) responsive but desktop-first (recommended: analytics show 4% mobile) b) mobile-first

- If OpenSpec is in use, run this conversation inside `/opsx:explore` so it feeds the proposal directly.
- If Haft is in use, `h-frame` can drive the framing questions. Keep it to the same small batch.

## 4. When the user won't elaborate

If the user says "just go", gives a one-word answer, or doesn't respond, proceed on your defaults. Put them in an **Assumptions** section of the brief or proposal, marked as revisable, so they're visible and easy to overturn. Don't ask a second batch unless a later step reveals a gap that would make the work wrong rather than just suboptimal.

## 5. Mid-flight gaps

If exploration or building uncovers a question that changes the direction (e.g. two user types with conflicting needs), stop and ask that one question. Otherwise note it and continue.
