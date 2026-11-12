"""Behavior checks for dependency discovery without reading user skill folders."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
DETECTOR = (
    ROOT / "plugins/ui-ux-design-council/skills/ui-ux-design-council/scripts/detect_deps.sh"
)


class DependencyDetectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="council detector ")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.project = self.base / "project with spaces"
        self.user_root = self.base / "user files"
        self.project.mkdir()
        self.user_root.mkdir()
        self.env = os.environ.copy()
        self.env.update(
            PATH="/usr/bin:/bin",
            XDG_CACHE_HOME=str(self.base / "cache"),
            DETECTOR_TEST_USER_ROOT=str(self.user_root),
            DETECTOR_TEST_ADMIN_ROOT=str(self.base / "admin skills"),
            GIT_CONFIG_NOSYSTEM="1",
            GIT_CONFIG_GLOBAL=os.devnull,
        )
        self.env.pop("DETECTOR_TEST_CODEX_ROOT", None)
        self.env.pop("DETECTOR_TEST_CLAUDE_ROOT", None)
        subprocess.run(
            ["git", "init", "--quiet", str(self.project)],
            env=self.env,
            check=True,
            capture_output=True,
        )
        # Redirect only filesystem lookup roots in a temporary copy. HOME,
        # CODEX_HOME and installed host configuration are never changed.
        source = DETECTOR.read_text()
        root_overrides = {
            'H="${HOME:-}"': 'H="${DETECTOR_TEST_USER_ROOT:?}"',
            'CODEX_DIR="${CODEX_HOME:-$H/.codex}"':
                'CODEX_DIR="${DETECTOR_TEST_CODEX_ROOT:-$H/.codex}"',
            'CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$H/.claude}"':
                'CLAUDE_DIR="${DETECTOR_TEST_CLAUDE_ROOT:-$H/.claude}"',
            'add_root admin  "/etc/codex/skills"':
                'add_root admin "$DETECTOR_TEST_ADMIN_ROOT"',
        }
        for original, replacement in root_overrides.items():
            self.assertEqual(source.count(original), 1, original)
            source = source.replace(original, replacement)
        self.script = self.base / "detect_deps.sh"
        self.script.write_text(source)

    def run_detector(self, *args, status=0, cwd=None):
        result = subprocess.run(
            ["/bin/bash", str(self.script), "--project", str(cwd or self.project), *args],
            env=self.env,
            text=True,
            capture_output=True,
            timeout=10,
        )
        self.assertEqual(result.returncode, status, result.stdout + result.stderr)
        return result.stdout if status == 0 else result.stderr

    def skill(self, root, name, folder=None):
        path = root / (folder or name) / "SKILL.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"---\nname: {name}\ndescription: Fixture.\n---\n")
        return path

    @staticmethod
    def line(output, prefix):
        return next(line for line in output.splitlines() if line.startswith(prefix))

    def test_repo_skill_takes_precedence_and_is_found_from_subdirectory(self):
        self.skill(self.user_root / ".agents/skills", "impeccable")
        local = self.skill(self.project / ".agents/skills", "impeccable")
        nested = self.project / "app" / "nested"
        nested.mkdir(parents=True)
        found = self.line(self.run_detector(cwd=nested), "seat craft-lead ")
        self.assertIn(f"INSTALLED repo {local}", found)
        self.assertIn("(+1 more copies)", found)

    def test_repo_plugin_is_repo_evidence(self):
        self.skill(self.project / ".claude/plugins/local/skills", "openspec-explore")
        output = self.run_detector()
        self.assertIn("fw openspec IN-USE repo skills:openspec-explore", output)

    def test_global_plugins_are_available_without_adopting_frameworks(self):
        plugins = self.user_root / ".claude/plugins/cache/vendor/bundle/1.0.0/skills"
        for name in ("openspec-explore", "h-spec", "quint-explore"):
            self.skill(plugins, name)
        output = self.run_detector()
        for framework in ("openspec", "haft", "quint"):
            self.assertIn(f"fw {framework} AVAILABLE global skills:", output)
            self.assertNotIn(f"fw {framework} IN-USE", output)

    def test_custom_codex_and_claude_roots_are_discovered(self):
        codex_root = self.base / "custom codex"
        claude_root = self.base / "custom claude"
        self.env["DETECTOR_TEST_CODEX_ROOT"] = str(codex_root)
        self.env["DETECTOR_TEST_CLAUDE_ROOT"] = str(claude_root)
        self.skill(codex_root / "plugins/cache/vendor/design/1.0.0/skills", "frontend-skill")
        self.skill(claude_root / "skills", "nielsen-heuristics-audit")
        output = self.run_detector()
        self.assertIn("seat native-builder frontend-skill INSTALLED plugin", output)
        self.assertIn("seat usability nielsen-heuristics-audit INSTALLED global", output)

    def test_cached_results_refresh_and_targeted_recheck(self):
        local = self.skill(self.project / ".agents/skills", "impeccable")
        first = self.run_detector()
        shutil.rmtree(local.parent)
        self.assertEqual(self.run_detector(), first)
        self.assertEqual(
            self.run_detector("--recheck", "craft-lead").strip(),
            "seat craft-lead impeccable MISSING - -",
        )
        self.skill(self.project / ".agents/skills", "impeccable")
        self.assertIn("seat craft-lead impeccable MISSING", self.run_detector())
        self.assertIn("seat craft-lead impeccable INSTALLED", self.run_detector("--refresh"))

    def test_declined_missing_seat_persists_until_installed(self):
        self.run_detector("--decline", "craft-lead")
        self.assertIn("declined craft-lead", self.run_detector())
        self.assertIn("declined craft-lead", self.run_detector("--refresh"))
        self.skill(self.project / ".agents/skills", "impeccable")
        self.assertNotIn("declined craft-lead", self.run_detector("--refresh"))

    def test_global_framework_decline_persists_until_repo_adoption(self):
        self.skill(self.user_root / ".agents/skills", "openspec-explore")
        self.run_detector()
        self.run_detector("--decline", "openspec")
        self.assertIn("declined openspec", self.run_detector("--refresh"))
        (self.project / "openspec").mkdir()
        self.assertNotIn("declined openspec", self.run_detector("--refresh"))

    def test_undecline_removes_only_selected_key(self):
        self.run_detector("--decline", "openspec")
        self.run_detector("--decline", "haft")
        self.run_detector("--undecline", "openspec")
        output = self.run_detector()
        self.assertNotIn("declined openspec", output)
        self.assertIn("declined haft", output)

    def test_invalid_arguments_fail_promptly(self):
        for args in (
            ("--project",),
            ("--recheck",),
            ("--decline",),
            ("--undecline",),
            ("--decline", "--refresh"),
            ("--recheck", "not-a-seat"),
            ("--decline", ".*"),
            ("--unknown",),
            ("--project", str(self.base / "missing")),
        ):
            with self.subTest(args=args):
                self.assertTrue(self.run_detector(*args, status=2).strip())

    def test_cache_path_is_read_only_and_legacy_cache_is_refreshed(self):
        cache = Path(self.run_detector("--cache-path").strip())
        self.assertFalse(cache.parent.exists())
        cache.parent.mkdir(parents=True)
        cache.write_text("# scanned legacy\nfw openspec IN-USE repo stale\ndeclined haft\n")
        output = self.run_detector()
        self.assertIn("# detector-cache-version 2", output)
        self.assertNotIn("stale", output)
        self.assertIn("declined haft", output)


if __name__ == "__main__":
    unittest.main()
