"""Artifact regression tests using local fixtures and a fake browser driver."""
import base64
import json
from html.parser import HTMLParser
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "plugins/ui-ux-design-council/skills/ui-ux-design-council"
BOARD = SKILL / "scripts/build_board.py"
CAPTURE = SKILL / "scripts/capture.mjs"
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2tIAAAAASUVORK5CYII=")
NODE = shutil.which("node")


class ParsedBoard(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.elements = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="council-artifact-test-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.workspace = self.base / "workspace with spaces"
        self.workspace.mkdir()
        self.log_path = self.workspace / "log.json"
        self.log = {
            "feature": "Example settings",
            "parity": {"breakpoints": [375], "states": ["default"], "themes": ["light"]},
            "iterations": [{"id": 1, "variants": [{"id": "A1", "status": "champion", "ref": {"url": "http://localhost:3000/?state={state}&theme={theme}"}}]}],
        }
        self.write_log()

    def write_log(self):
        self.log_path.write_text(json.dumps(self.log))

    def run_board(self, *args):
        self.write_log()
        return subprocess.run([sys.executable, str(BOARD), str(self.log_path), *args], text=True, capture_output=True, cwd=self.base, timeout=10)

    def shot(self, name="375-default.png"):
        folder = self.workspace / "shots/iter-01/A1"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / name
        path.write_bytes(PNG)
        return path

    def assert_rejected(self, result, message):
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(message, result.stderr)
        self.assertFalse((self.workspace / "board.html").exists())

    def test_valid_example_generates_board_and_inlines_only_shots(self):
        self.log = json.loads((SKILL / "assets/log.example.json").read_text())
        self.shot()
        result = self.run_board("--inline")
        self.assertEqual(result.returncode, 0, result.stderr)
        source = (self.workspace / "board.html").read_text()
        self.assertIn("Champion lineage", source)
        self.assertIn("data:image/png;base64," + base64.b64encode(PNG).decode(), source)

    def test_nested_output_uses_relative_image_url(self):
        self.shot()
        (self.workspace / "exports").mkdir()
        result = self.run_board("--out", "exports/comparison.html")
        self.assertEqual(result.returncode, 0, result.stderr)
        parsed = ParsedBoard((self.workspace / "exports/comparison.html").read_text())
        self.assertIn("../shots/iter-01/A1/375-default.png", [a.get("src") for t, a in parsed.elements if t == "img"])

    def test_text_and_filenames_cannot_add_html_attributes_or_elements(self):
        payload = '<img src=x onerror="throw 123">'
        self.log["feature"] = payload
        self.log["iterations"][0]["variants"][0]["notes"] = payload
        self.shot('375-default" onerror="throw 123.png')
        result = self.run_board()
        self.assertEqual(result.returncode, 0, result.stderr)
        parsed = ParsedBoard((self.workspace / "board.html").read_text())
        self.assertFalse(any("onerror" in attrs for _, attrs in parsed.elements))
        self.assertFalse(any(attrs.get("src") == "x" for _, attrs in parsed.elements))
        self.assertTrue(any("%22%20onerror%3D%22" in attrs.get("src", "") for _, attrs in parsed.elements))

    def test_malicious_numeric_values_are_rejected_before_output(self):
        for key, value, message in [("nielsen", {"3": '<img src=x onerror="throw 123">'}, "Nielsen counts"), ("scores", {"usability": "5' onclick='throw 123"}, "scores must")]:
            with self.subTest(key=key):
                variant = self.log["iterations"][0]["variants"][0]
                variant[key] = value
                self.assert_rejected(self.run_board(), message)
                del variant[key]

    def test_variant_traversal_is_rejected(self):
        for value in ["..", "../../outside", "/tmp/outside", "C:\\outside"]:
            with self.subTest(value=value):
                self.log["iterations"][0]["variants"][0]["id"] = value
                self.assert_rejected(self.run_board("--inline"), "variant ID")

    def test_symlinked_image_cannot_inline_external_content(self):
        outside = self.base / "private.png"
        outside.write_bytes(b"outside secret marker")
        shot = self.shot()
        shot.unlink()
        shot.symlink_to(outside)
        self.assert_rejected(self.run_board("--inline"), "escapes the log workspace")

    def test_symlinked_shots_directory_is_rejected(self):
        outside = self.base / "outside"
        outside.mkdir()
        (self.workspace / "shots").symlink_to(outside, target_is_directory=True)
        self.assert_rejected(self.run_board(), "escapes the log workspace")

    def test_output_traversal_and_symlink_do_not_overwrite_external_file(self):
        outside = self.base / "private.html"
        outside.write_text("preserve me")
        result = self.run_board("--out", "../private.html")
        self.assert_rejected(result, "escapes the log workspace")
        (self.workspace / "linked.html").symlink_to(outside)
        result = self.run_board("--out", "linked.html")
        self.assert_rejected(result, "escapes the log workspace")
        self.assertEqual(outside.read_text(), "preserve me")

    def test_lineage_cycle_fails_without_hanging(self):
        self.log["iterations"][0]["variants"][0]["parent"] = "A1"
        self.assert_rejected(self.run_board(), "lineage contains a cycle")

    @unittest.skipUnless(NODE, "Node.js is required for capture and DOM tests")
    def test_ab_comparison_uses_dom_properties_for_untrusted_image_values(self):
        self.shot()
        result = self.run_board()
        self.assertEqual(result.returncode, 0, result.stderr)
        source = (self.workspace / "board.html").read_text()
        script = re.search(r"<script>(.*?)</script>", source, re.S).group(1)
        fixture = self.base / "check-dom.cjs"
        fixture.write_text('''const vm = require('node:vm');
const input = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
function element(tag) {
  return {tag, children: [], style: {}, options: [], value: '',
    set innerHTML(value) { throw Error('HTML injection sink used'); },
    append(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    addEventListener() {}, querySelector() { return element('img'); }};
}
const nodes = Object.fromEntries(['a','b','op','abv','zoom'].map(id => [id, element(id)]));
nodes.a.value = '\" onerror=\"throw 123'; nodes.b.value = nodes.a.value; nodes.op.value = '50';
let mode = 'side';
const document = {getElementById: id => nodes[id], createElement: element,
  querySelector: () => ({value: mode}), querySelectorAll: () => []};
const context = {document}; vm.runInNewContext(input.script, context);
if (nodes.abv.children[0].children[0].children[0].src !== nodes.a.value) throw Error('image property lost');
mode = 'over'; context.r();
if (nodes.abv.children[0].children[1].src !== nodes.b.value) throw Error('overlay image property lost');
''')
        result = subprocess.run([NODE, str(fixture)], input=json.dumps({"script": script}), text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def fake_playwright(self):
        module = self.base / "node_modules/playwright"
        module.mkdir(parents=True)
        (module / "index.js").write_text('''const fs = require('node:fs');
module.exports = {chromium: {launch: async () => ({
  newContext: async () => ({newPage: async () => ({
    setViewportSize: async () => {}, goto: async () => {}, waitForTimeout: async () => {},
    screenshot: async ({path}) => fs.writeFileSync(path, 'test screenshot')
  }), close: async () => {}}), close: async () => {}
})}};
''')

    def run_capture(self):
        self.write_log()
        return subprocess.run([NODE, str(CAPTURE), str(self.log_path)], cwd=self.base, text=True, capture_output=True, timeout=10)

    @unittest.skipUnless(NODE, "Node.js is required for capture tests")
    def test_capture_valid_log_writes_expected_file(self):
        self.fake_playwright()
        result = self.run_capture()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.workspace / "shots/iter-01/A1/375-default.png").read_text(), "test screenshot")

    @unittest.skipUnless(NODE, "Node.js is required for capture tests")
    def test_capture_rejects_all_untrusted_path_components_before_loading_browser(self):
        for section, key, value in [("variant", "id", "../../outside"), ("parity", "states", ["../outside"]), ("parity", "themes", ["../../outside"]), ("parity", "breakpoints", ["../../outside"])]:
            with self.subTest(key=key):
                target = self.log["iterations"][0]["variants"][0] if section == "variant" else self.log["parity"]
                previous = target[key]
                target[key] = value
                result = self.run_capture()
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("Playwright not found", result.stderr)
                self.assertFalse((self.workspace / "shots").exists())
                target[key] = previous

    @unittest.skipUnless(NODE, "Node.js is required for capture tests")
    def test_capture_rejects_symlinked_output_file(self):
        self.fake_playwright()
        outside = self.base / "private.png"
        outside.write_bytes(b"preserve me")
        shot = self.shot()
        shot.unlink()
        shot.symlink_to(outside)
        result = self.run_capture()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("escapes the log workspace", result.stderr)
        self.assertEqual(outside.read_bytes(), b"preserve me")

    @unittest.skipUnless(NODE, "Node.js is required for capture tests")
    def test_capture_rejects_symlinked_output_directory(self):
        self.fake_playwright()
        outside = self.base / "outside"
        outside.mkdir()
        (self.workspace / "shots").symlink_to(outside, target_is_directory=True)
        result = self.run_capture()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("escapes the log workspace", result.stderr)
        self.assertEqual(list(outside.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
