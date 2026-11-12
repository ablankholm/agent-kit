# Fallbacks for missing seats

Use these only when the user declined installing a seat. Fallbacks are thinner than the real skills, so say in the final summary which seats used them.

## impeccable missing → craft lead fallback

- Write `PRODUCT.md` (audience, jobs, brand lane, voice, anti-references) and `DESIGN.md` (tokens, type scale, spacing scale, components, patterns) yourself from the Step 1 inventory.
- Use the slop checklist in `arbitration.md` as the anti-pattern detector.
- Polish pass: align everything to the spacing scale; at most 2 typefaces and 1 to 2 accents; consistent radii; clear hierarchy through weight, contrast and space rather than extra boxes; remove decoration that carries no information.

## nielsen-heuristics-audit missing → usability judge fallback

Evaluate against Nielsen's 10 heuristics. For each violation record: heuristic, location, severity (0 none, 1 cosmetic, 2 minor, 3 major, 4 catastrophic), and fix.

1. Visibility of system status
2. Match between system and the real world
3. User control and freedom
4. Consistency and standards
5. Error prevention
6. Recognition rather than recall
7. Flexibility and efficiency of use
8. Aesthetic and minimalist design
9. Help users recognize, diagnose and recover from errors
10. Help and documentation

Also check the Laws of UX where relevant: Fitts (target size and distance), Hick (choice count), Miller/chunking, Jakob (follow familiar conventions), Tesler (where complexity lives).

## ui-ux-pro-max missing → style catalog fallback

Generate 3 candidate style systems that fit the product type, audience and existing tokens. Each gets a type pairing (display + text, with rationale), a palette (neutrals + 1 to 2 accents + semantic colors, with contrast verified), a radius/shadow/density stance and a reference "feels like" description. Avoid the slop checklist defaults.

## frontend-design / frontend-skill missing → native builder fallback

Before building, state a one-sentence visual thesis. Commit to it: distinctive typography, deliberate color, layout with rhythm and asymmetry where it helps, and restrained purposeful motion that respects `prefers-reduced-motion`. Build with the repo's stack and tokens.

## review-ux-ui / ss-audit missing

- Flows/a11y: walk each flow step by step (entry, each decision, errors, exit). Check WCAG 2.1 AA: contrast ≥4.5:1 for text and 3:1 for UI, visible focus, full keyboard path, labels, landmarks, alt text, no information carried by color alone.
- Mobile: touch targets ≥44×44pt (iOS) / 48dp (Android); safe-area insets; thumb reach for primary actions; no hover-only affordances; no dark patterns (confirmshaming, hidden costs, forced continuity).
