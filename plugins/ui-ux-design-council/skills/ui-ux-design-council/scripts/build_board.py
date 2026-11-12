#!/usr/bin/env python3
"""Build a static comparison board for ui-ux-design-council.

Usage: python3 build_board.py <workspace>/log.json [--out board.html] [--inline]

Reads log.json (schema: references/comparison.md) and screenshots at
shots/iter-NN/<variant>/<bp>-<state>[-<theme>].png next to it. Writes one HTML
file with: score trend across iterations (with regression flags), per-iteration
variant grid + score table, champion lineage view, and an A/B overlay for any
two shots (within or across iterations). --inline embeds images as base64 so
the board is a single shareable file. Python 3.9+, stdlib only.
"""
import argparse, base64, html, json, math, os, re, sys
from pathlib import Path
from urllib.parse import quote

def esc(s): return html.escape(str(s if s is not None else ""))

def component(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", value):
        raise ValueError(f"{label} must be a filename component using letters, digits, dots, underscores or hyphens")
    return value


def confined(path, root):
    resolved = path.resolve()
    if not resolved.is_relative_to(root):
        raise ValueError("artifact path escapes the log workspace")
    return resolved


def validate_log(log):
    iteration_ids, variant_ids = set(), set()
    for iteration in log.get("iterations", []):
        iid = iteration["id"]
        if type(iid) is not int or iid < 0 or iid in iteration_ids:
            raise ValueError("iteration IDs must be unique nonnegative integers")
        iteration_ids.add(iid)
        for variant in iteration.get("variants", []):
            vid = component(variant["id"], "variant ID")
            if vid in variant_ids:
                raise ValueError("variant IDs must be unique across iterations")
            variant_ids.add(vid)
            for score in (variant.get("scores") or {}).values():
                if type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 5:
                    raise ValueError("scores must be finite numbers between 0 and 5")
            for count in (variant.get("nielsen") or {}).values():
                if type(count) is not int or count < 0:
                    raise ValueError("Nielsen counts must be nonnegative integers")
    for weight in (log.get("rubric") or {}).values():
        if type(weight) not in (int, float) or not math.isfinite(weight) or weight <= 0:
            raise ValueError("rubric weights must be positive finite numbers")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("log")
    parser.add_argument("--out", help="HTML output path within the log workspace; relative paths start there")
    parser.add_argument("--inline", action="store_true")
    args = parser.parse_args()
    log_path = Path(args.log).resolve(); root = log_path.parent
    requested_out = Path(args.out) if args.out else Path("board.html")
    out = confined(requested_out if requested_out.is_absolute() else root / requested_out, root)
    inline = args.inline
    log = json.loads(log_path.read_text())
    validate_log(log)
    rubric = log.get("rubric") or {"brief_fit": 3, "usability": 3, "a11y": 2, "consistency": 2, "distinctiveness": 1, "feasibility": 1}
    parity = log.get("parity", {})
    state_order = {s: i for i, s in enumerate(parity.get("states", []))}
    iters = sorted(log.get("iterations", []), key=lambda i: i["id"])

    variants = {}  # id -> (iteration id, variant dict)
    for it in iters:
        for v in it.get("variants", []):
            variants[v["id"]] = (it["id"], v)

    def weighted(v):
        s = v.get("scores") or {}
        if not s: return None
        num = sum(s.get(k, 0) * w for k, w in rubric.items() if k in s)
        den = sum(5 * w for k, w in rubric.items() if k in s)
        return round(100 * num / den) if den else None

    def predecessor(v):
        if v.get("parent") in variants: return variants[v["parent"]][1]
        srcs = [variants[m][1] for m in v.get("merged_from", []) if m in variants]
        srcs = [s for s in srcs if weighted(s) is not None]
        return max(srcs, key=weighted) if srcs else None

    def regressions(v):
        p = predecessor(v); flags = []
        if not p: return flags
        for k in rubric:
            if k in (v.get("scores") or {}) and k in (p.get("scores") or {}) and v["scores"][k] <= p["scores"][k] - 1:
                flags.append(f"{k} {p['scores'][k]}→{v['scores'][k]}")
        nv, np_ = v.get("nielsen") or {}, p.get("nielsen") or {}
        for sev in ("4", "3"):
            if nv.get(sev, 0) > np_.get(sev, 0):
                flags.append(f"+{nv[sev] - np_.get(sev, 0)} Nielsen sev{sev}")
        return flags

    def root_of(vid):
        seen = set()
        while vid in variants and variants[vid][1].get("parent") in variants and vid not in seen:
            seen.add(vid); vid = variants[vid][1]["parent"]
        return vid

    def shots_for(iter_id, vid):
        d = confined(root / "shots" / f"iter-{iter_id:02d}" / vid, root)
        files = sorted(d.glob("*.png")) if d.is_dir() else []
        for path in files:
            confined(path, root)
        def key(p):
            parts = p.stem.split("-")
            bp = int(parts[0]) if parts[0].isdigit() else 0
            st = parts[1] if len(parts) > 1 else ""
            return (state_order.get(st, 99), st, bp, p.stem)
        return sorted(files, key=key)

    def src(p):
        safe_path = confined(p, root)
        if inline: return "data:image/png;base64," + base64.b64encode(safe_path.read_bytes()).decode()
        return esc(quote(os.path.relpath(safe_path, out.parent).replace(os.sep, "/"), safe="/"))

    def badge(status): return f'<span class="badge b-{esc(status)}">{esc(status)}</span>' if status else ""

    # ---- trend table ----
    lineages = {}
    for vid, (iid, v) in variants.items():
        lineages.setdefault(root_of(vid), {})[iid] = v
    trend = ['<table class="trend"><thead><tr><th>Lineage</th>' + "".join(f"<th>Iter {it['id']}</th>" for it in iters) + "</tr></thead><tbody>"]
    for r in sorted(lineages):
        row = [f"<tr><th>{esc(r)}</th>"]
        for it in iters:
            v = lineages[r].get(it["id"])
            if not v: row.append('<td class="empty">·</td>'); continue
            w = weighted(v); p = predecessor(v); pw = weighted(p) if p else None
            delta = "" if w is None or pw is None else (f'<span class="up">▲{w-pw}</span>' if w > pw else f'<span class="down">▼{pw-w}</span>' if w < pw else '<span class="flat">=</span>')
            flags = regressions(v)
            fl = f'<div class="flag" title="{esc("; ".join(flags))}">⚠ {esc(flags[0])}{" +" + str(len(flags)-1) if len(flags) > 1 else ""}</div>' if flags else ""
            merged = f'<div class="muted">← {esc(", ".join(v.get("merged_from", [])))}</div>' if v.get("merged_from") else ""
            row.append(f'<td><b>{esc(v["id"])}</b> {w if w is not None else "n/a"} {delta} {badge(v.get("status"))}{merged}{fl}</td>')
        trend.append("".join(row) + "</tr>")
    trend.append("</tbody></table>")

    # ---- per-iteration sections ----
    all_shots = []  # (label, src)
    sections = []
    for it in iters:
        vs = it.get("variants", [])
        head = f"""<section class="iter" id="iter-{it['id']}">
<h2>Iteration {it['id']} <span class="muted">{esc(it.get('date',''))}</span></h2>
<dl class="meta">
{f"<dt>Goal</dt><dd>{esc(it['goal'])}</dd>" if it.get('goal') else ""}
{f"<dt>Count</dt><dd>{esc(it['count_rationale'])}</dd>" if it.get('count_rationale') else ""}
{f"<dt>Feedback</dt><dd>{esc(it['feedback'])}</dd>" if it.get('feedback') else ""}
{f"<dt>Decision</dt><dd>{esc(it['decision'])} <span class='muted'>({esc(it.get('decided_by',''))})</span></dd>" if it.get('decision') else ""}
</dl>"""
        # score table
        st = ['<table class="scores"><thead><tr><th></th>' + "".join(f"<th>{esc(v['id'])} {badge(v.get('status'))}</th>" for v in vs) + "</tr></thead><tbody>"]
        st.append("<tr><th>Thesis</th>" + "".join(f"<td class='thesis'>{esc(v.get('thesis',''))}</td>" for v in vs) + "</tr>")
        if any(v.get("axes") for v in vs):
            st.append("<tr><th>Axes</th>" + "".join("<td>" + esc(", ".join(f"{k}: {x}" for k, x in (v.get('axes') or {}).items())) + "</td>" for v in vs) + "</tr>")
        if any(v.get("parent") or v.get("merged_from") for v in vs):
            st.append("<tr><th>From</th>" + "".join(f"<td>{esc(v.get('parent') or ', '.join(v.get('merged_from', [])) or 'none')}</td>" for v in vs) + "</tr>")
        for k, w in rubric.items():
            cells = []
            for v in vs:
                s = (v.get("scores") or {}).get(k)
                cells.append(f"<td class='num s{esc(s)}'>{esc(s) if s is not None else 'n/a'}</td>")
            st.append(f"<tr><th>{esc(k)} <span class='muted'>×{esc(w)}</span></th>{''.join(cells)}</tr>")
        st.append("<tr class='total'><th>Weighted</th>" + "".join(f"<td class='num'>{weighted(v) if weighted(v) is not None else 'n/a'}</td>" for v in vs) + "</tr>")
        st.append("<tr><th>Nielsen 4/3/2/1</th>" + "".join("<td class='num'>" + "/".join(esc((v.get('nielsen') or {}).get(s, 0)) for s in '4321') + "</td>" for v in vs) + "</tr>")
        st.append("<tr><th>Slop flags</th>" + "".join(f"<td class='num'>{esc(v.get('slop_flags', 'n/a'))}</td>" for v in vs) + "</tr>")
        if any(v.get("notes") for v in vs):
            st.append("<tr><th>Notes</th>" + "".join(f"<td class='thesis'>{esc(v.get('notes',''))}</td>" for v in vs) + "</tr>")
        st.append("</tbody></table>")
        # grid
        by_key = {}
        for v in vs:
            for p in shots_for(it["id"], v["id"]):
                by_key.setdefault(p.stem, {})[v["id"]] = p
                all_shots.append((f"Iter {it['id']} · {v['id']} · {p.stem}", src(p)))
        grid = []
        if by_key:
            grid.append(f'<div class="grid" style="--cols:{len(vs)}"><div class="gh"></div>' + "".join(f'<div class="gh">{esc(v["id"])}</div>' for v in vs))
            for k in sorted(by_key, key=lambda s: (state_order.get(s.split('-')[1] if '-' in s else '', 99), s.split('-')[1:] , int(s.split('-')[0]) if s.split('-')[0].isdigit() else 0)):
                grid.append(f'<div class="rk">{esc(k)}</div>')
                for v in vs:
                    p = by_key[k].get(v["id"])
                    grid.append(f'<figure><img loading="lazy" src="{src(p)}" alt="{esc(v["id"])} {esc(k)}" onclick="zoom(this)"></figure>' if p else '<figure class="missing">no shot</figure>')
            grid.append("</div>")
        else:
            grid.append('<p class="muted">No screenshots yet for this iteration (expected under shots/iter-%02d/&lt;variant&gt;/).</p>' % it["id"])
        sections.append(head + "".join(st) + "".join(grid) + "</section>")

    # ---- champion lineage ----
    champ = None
    for it in reversed(iters):
        champ = next((v for v in it.get("variants", []) if v.get("status") == "champion"), None)
        if champ: break
    lineage_html = ""
    if champ:
        chain, cur, seen = [], champ, set()
        while cur:
            if cur["id"] in seen:
                raise ValueError("champion lineage contains a cycle")
            seen.add(cur["id"])
            chain.append(cur); nxt = cur.get("parent")
            cur = variants[nxt][1] if nxt in variants else None
        chain.reverse()
        keys = {}
        for v in chain:
            for p in shots_for(variants[v["id"]][0], v["id"]):
                keys.setdefault(p.stem, {})[v["id"]] = p
        rows = [f'<div class="grid" style="--cols:{len(chain)}"><div class="gh"></div>' + "".join(f'<div class="gh">{esc(v["id"])} <span class="muted">it{variants[v["id"]][0]}</span></div>' for v in chain)]
        for k in sorted(keys):
            rows.append(f'<div class="rk">{esc(k)}</div>' + "".join(f'<figure><img loading="lazy" src="{src(keys[k][v["id"]])}" onclick="zoom(this)"></figure>' if v["id"] in keys[k] else '<figure class="missing">no shot</figure>' for v in chain))
        rows.append("</div>")
        lineage_html = f'<section id="lineage"><h2>Champion lineage: {" → ".join(esc(v["id"]) for v in chain)}</h2>{"".join(rows) if keys else "<p class=muted>No screenshots.</p>"}</section>'

    opts = "".join(f'<option value="{s}">{esc(l)}</option>' for l, s in all_shots)
    nav = " ".join(f'<a href="#iter-{it["id"]}">Iter {it["id"]}</a>' for it in iters)
    doc = TEMPLATE.format(
        title=esc(log.get("feature", "Design board")),
        brief=(f'<span class="muted">brief: {esc(log["brief_ref"])}</span>' if log.get("brief_ref") else ""),
        champ=(f'Champion: <b>{esc(champ["id"])}</b>: {esc(champ.get("thesis",""))}' if champ else "No champion yet"),
        nav=nav + (' <a href="#lineage">Lineage</a>' if lineage_html else "") + ' <a href="#ab">A/B</a>',
        trend="".join(trend), sections="".join(reversed(sections)), lineage=lineage_html, opts=opts,
        parity=esc(" · ".join(f"{k}: " + (", ".join(map(str, v)) if isinstance(v, list) else str(v)) for k, v in parity.items())),
    )
    confined(out, root).write_text(doc)
    print(f"wrote {out} ({len(all_shots)} shots, {len(iters)} iterations{', inline' if inline else ''})")

TEMPLATE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · design board</title>
<style>
:root{{--bg:#f6f5f2;--fg:#1d1c1a;--muted:#6f6b63;--line:#dedad2;--card:#fff;--accent:#0b6e4f;--up:#0b6e4f;--down:#b42318;--warn:#9a6700}}
@media (prefers-color-scheme:dark){{:root{{--bg:#151513;--fg:#ecebe7;--muted:#9b978e;--line:#2f2e2a;--card:#1d1d1a;--accent:#4cc38a;--up:#4cc38a;--down:#ff7b72;--warn:#d29922}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
header{{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 20px;display:flex;flex-wrap:wrap;gap:6px 24px;align-items:baseline}}
header h1{{font-size:16px;margin:0;letter-spacing:-.01em}}nav a{{color:var(--fg);margin-right:12px;text-decoration:none;border-bottom:1px solid var(--line)}}nav a:hover{{border-color:var(--accent)}}
main{{padding:16px 20px 80px;max-width:1600px}}h2{{font-size:15px;margin:32px 0 8px}}.muted{{color:var(--muted);font-weight:400}}
table{{border-collapse:collapse;background:var(--card);border:1px solid var(--line);margin:8px 0 16px;font-variant-numeric:tabular-nums}}th,td{{border-bottom:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}}thead th{{font-weight:600}}tbody th{{font-weight:500;white-space:nowrap}}
.num{{text-align:right}}.thesis{{max-width:260px;color:var(--muted)}}.total td{{font-weight:700}}.s1,.s2{{color:var(--down)}}.s5{{color:var(--up);font-weight:600}}
.up{{color:var(--up)}}.down{{color:var(--down)}}.flat{{color:var(--muted)}}.flag{{color:var(--warn);font-size:12px}}.empty{{color:var(--line)}}
.badge{{font-size:11px;padding:1px 6px;border-radius:3px;border:1px solid var(--line);color:var(--muted)}}.b-champion{{border-color:var(--accent);color:var(--accent);font-weight:600}}.b-dropped{{text-decoration:line-through}}
dl.meta{{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;margin:0 0 8px}}dt{{color:var(--muted)}}dd{{margin:0}}
.grid{{display:grid;grid-template-columns:120px repeat(var(--cols),minmax(160px,1fr));gap:8px;align-items:start}}.gh{{font-weight:600;position:sticky;top:52px;background:var(--bg);padding:4px 0}}.rk{{font:12px ui-monospace,monospace;color:var(--muted);padding-top:4px}}
figure{{margin:0;background:var(--card);border:1px solid var(--line)}}figure img{{display:block;width:100%;height:auto;max-height:520px;object-fit:cover;object-position:top;cursor:zoom-in}}.missing{{padding:24px;text-align:center;color:var(--muted);font-size:12px}}
#ab .ctl{{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}}select{{max-width:420px;font:inherit;background:var(--card);color:var(--fg);border:1px solid var(--line);padding:4px}}
.ab-side{{display:grid;grid-template-columns:1fr 1fr;gap:8px}}.ab-over{{position:relative;display:inline-block;max-width:100%}}.ab-over img{{display:block;max-width:100%}}.ab-over img+img{{position:absolute;inset:0}}
#zoom{{position:fixed;inset:0;background:rgba(0,0,0,.85);display:none;align-items:flex-start;justify-content:center;overflow:auto;z-index:10;padding:20px;cursor:zoom-out}}#zoom img{{max-width:100%}}
@media (max-width:700px){{.grid{{grid-template-columns:80px repeat(var(--cols),minmax(140px,1fr));overflow-x:auto}}.ab-side{{grid-template-columns:1fr}}}}
</style></head><body>
<header><h1>{title}</h1><span>{champ}</span>{brief}<nav>{nav}</nav></header>
<main>
<h2>Score trend <span class="muted">weighted /100 · ▲▼ vs parent (or best merge source) · ⚠ regression</span></h2>{trend}
<p class="muted">Parity: {parity}</p>
{sections}
{lineage}
<section id="ab"><h2>A/B compare <span class="muted">any two shots, same or different iterations</span></h2>
<div class="ctl"><select id="a">{opts}</select><select id="b">{opts}</select>
<label><input type="radio" name="m" value="side" checked> side by side</label><label><input type="radio" name="m" value="over"> overlay</label>
<input id="op" type="range" min="0" max="100" value="50" aria-label="overlay opacity"></div>
<div id="abv"></div></section>
</main><div id="zoom" onclick="this.style.display='none'"><img alt=""></div>
<script>
function zoom(i){{var z=document.getElementById('zoom');z.querySelector('img').src=i.src;z.style.display='flex'}}
var A=document.getElementById('a'),B=document.getElementById('b'),O=document.getElementById('op'),V=document.getElementById('abv');
if(B.options.length>1)B.selectedIndex=1;
function r(){{var m=document.querySelector('input[name=m]:checked').value;
V.replaceChildren();
if(!A.value){{var p=document.createElement('p');p.className='muted';p.textContent='No screenshots yet.';V.append(p);return}}
var wrap=document.createElement('div');wrap.className=m=='side'?'ab-side':'ab-over';
[A.value,B.value].forEach(function(src,index){{
var img=document.createElement('img');img.src=src;
if(m=='side'){{var figure=document.createElement('figure');figure.append(img);wrap.append(figure)}}
else{{if(index==1){{img.id='ovb';img.style.opacity=O.value/100}}wrap.append(img)}}
}});V.append(wrap);}}
[A,B,O].forEach(function(e){{e.addEventListener('input',r)}});document.querySelectorAll('input[name=m]').forEach(function(e){{e.addEventListener('change',r)}});r();
</script></body></html>"""

if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError) as error:
        sys.exit(f"error: {error}")
