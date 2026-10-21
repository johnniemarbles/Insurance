#!/usr/bin/env python3
"""
Automated PII & Secret Leakage Scanner for PII Platform.
Scans source code for accidental exposure of Canadian SINs, US SSNs, credit cards,
unencrypted private keys, and live production API tokens.
"""

import os
import re
import sys
from pathlib import Path

# Paths/directories to ignore
IGNORED_DIRS = {
    '.git',
    'node_modules',
    'dist',
    '.turbo',
    'coverage',
    '.nyc_output',
    'screens',
    '__pycache__',
    '.pytest_cache',
}

IGNORED_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz',
    '.woff', '.woff2', '.ttf', '.eot', '.lock', '.map',
}

# Explicitly allowed files (e.g. documentation, test configs, scanner itself)
ALLOWED_FILES = {
    'package-lock.json',
    'tests/security/scan_pii_leaks.py',
    '.gitleaks.toml',
}

# Regex patterns for high-severity PII and secrets
SECRET_PATTERNS = {
    'PRIVATE_KEY': re.compile(r'-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----'),
    'AWS_KEY': re.compile(r'\b(AKIA[0-9A-Z]{16})\b'),
    'STRIPE_LIVE_KEY': re.compile(r'\brk_live_[0-9a-zA-Z]{24,}\b|\bsk_live_[0-9a-zA-Z]{24,}\b'),
    'GITHUB_TOKEN': re.compile(r'\bghp_[0-9a-zA-Z]{36}\b|\bgithub_pat_[0-9a-zA-Z_]{22,}\b'),
}

# Canadian SIN pattern (3 groups of 3 digits: XXX-XXX-XXX)
SIN_REGEX = re.compile(r'\b(\d{3})[- ]?(\d{3})[- ]?(\d{3})\b')

# US SSN pattern (XXX-XX-XXXX)
SSN_REGEX = re.compile(r'\b(?!000|666|9\d{2})(\d{3})-(?!00)(\d{2})-(?!0000)(\d{4})\b')


def luhn_checksum(digits: str) -> bool:
    """Validate a numeric string using the standard Luhn checksum algorithm."""
    s = 0
    reverse_digits = digits[::-1]
    for i, digit in enumerate(reverse_digits):
        d = int(digit)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        s += d
    return (s % 10) == 0


def is_allowlisted_path(rel_path: str) -> bool:
    """Check if file is in an allowlisted test fixture or mock directory."""
    if rel_path in ALLOWED_FILES:
        return True
    # Test directories may contain synthetic test data
    if rel_path.startswith(('tests/', 'apps/*/test/', 'packages/*/test/')):
        return True
    return False


def scan_file(file_path: Path, repo_root: Path):
    rel_path = file_path.relative_to(repo_root).as_posix()
    if is_allowlisted_path(rel_path):
        return []

    findings = []
    try:
        content = file_path.read_text(encoding='utf-8', errors='ignore')
    except Exception as e:
        return []

    lines = content.splitlines()
    for line_idx, line in enumerate(lines, 1):
        # 1. High-severity secrets
        for rule_name, pat in SECRET_PATTERNS.items():
            if pat.search(line):
                findings.append({
                    'file': rel_path,
                    'line': line_idx,
                    'type': rule_name,
                    'snippet': line.strip()[:80]
                })

        # 2. US SSN checks
        for m in SSN_REGEX.finditer(line):
            ssn = m.group(0)
            # Exclude obvious placeholder numbers
            if not ssn.startswith(('123-45', '012-34', '555-55')):
                findings.append({
                    'file': rel_path,
                    'line': line_idx,
                    'type': 'US_SSN',
                    'snippet': f"SSN pattern detected: {ssn[:3]}-XX-XXXX"
                })

        # 3. Canadian SIN checks (validated with Luhn)
        for m in SIN_REGEX.finditer(line):
            sin_raw = "".join(m.groups())
            # Dummy/sample sequences
            if sin_raw in ('123456789', '987654321', '111111111', '000000000'):
                continue
            if luhn_checksum(sin_raw):
                findings.append({
                    'file': rel_path,
                    'line': line_idx,
                    'type': 'CANADIAN_SIN',
                    'snippet': f"SIN pattern detected: {sin_raw[:3]}-XXX-XXX"
                })

    return findings


def run_scanner(repo_root: Path) -> int:
    print(f"🔒 Scanning repository for PII and secret leaks at: {repo_root}")
    all_findings = []

    for path in repo_root.rglob('*'):
        if path.is_file():
            # Check directory exclusion
            if any(part in IGNORED_DIRS for part in path.parts):
                continue
            if path.suffix.lower() in IGNORED_EXTENSIONS:
                continue
            findings = scan_file(path, repo_root)
            all_findings.extend(findings)

    if all_findings:
        print("\n❌ SECURITY SCAN FAILED - PII / Secret Leaks Detected:\n")
        for f in all_findings:
            print(f"  [{f['type']}] {f['file']}:{f['line']} -> {f['snippet']}")
        print(f"\nTotal violations found: {len(all_findings)}")
        return 1

    print("✅ PII & Secret Leakage scan passed! No unencrypted credentials or live PII detected.")
    return 0


def self_test():
    """Unit test for scanner pattern verification."""
    print("Running scanner self-test...")
    assert luhn_checksum("046454286") is True  # Valid test SIN with Luhn
    assert luhn_checksum("123456783") is False
    print("Self-test passed.")


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--test':
        self_test()
        sys.exit(0)

    root = Path(__file__).resolve().parent.parent.parent
    sys.exit(run_scanner(root))
