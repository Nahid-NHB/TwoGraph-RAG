# Security Policy

## Supported Versions

TwoGraph-RAG is pre-1.0. Security fixes land on the latest `0.x` release only
— there are no parallel maintenance branches yet.

| Version  | Supported |
| -------- | --------- |
| latest   | ✅        |
| < latest | ❌        |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report it privately via
[GitHub's private vulnerability reporting](https://github.com/Nahid-NHB/TwoGraph-RAG/security/advisories/new)
for this repository, or email **nahid151341@gmail.com** with:

- A description of the vulnerability and its potential impact
- Steps to reproduce (a minimal repro is very helpful)
- Any relevant logs, versions, or configuration

We aim to acknowledge reports within 5 business days and to ship a fix or
mitigation as quickly as the severity warrants. We'll credit reporters in the
release notes unless you'd prefer to stay anonymous.

## Scope

This covers the `@twograph/*` packages and the `twograph` CLI in this
repository. It does not cover third-party dependencies (report those
upstream) or the Memgraph/Qdrant services themselves.
