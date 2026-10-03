# Secureport GitHub Action

Uploads a scanner's output to Secureport — or asks Secureport to scan the
target — renders a report, and optionally fails the job on a new or regressed
severity.

This repository is a public mirror of the `action/` directory in
[`agbjordan/secureport`](https://github.com/agbjordan/secureport), the
private monorepo this project is developed in. It's kept in sync
automatically on every promotion that changes the Action — don't send pull
requests here; open them against the source repo instead. See
[`@secureport/cli` on npm](https://www.npmjs.com/package/@secureport/cli)
for the CLI this Action wraps, and `secureport --help` for every command it
runs under the hood.

## Usage

```yaml
permissions:
  pull-requests: write # only needed for the PR comment — see Permissions below

steps:
  - uses: agbjordan/secureport-action@56265d14e5de1e0066ba66bfe123495a9cc866a6 # v1.0.0
    with:
      cli-version: '0.5.1' # exact version, never a range or a moving tag — 0.2.0 predates hosted mode
      target-id: target_your_target_id
      file: scan-results.jsonl
      fail-on: high # optional — omit or 'none' to never gate on severity
    env:
      SECUREPORT_API_KEY: ${{ secrets.SECUREPORT_API_KEY }}
      SECUREPORT_API_URL: ${{ vars.SECUREPORT_API_URL }}
```

**Pin the Action by commit SHA**, as above, so the code that runs with your
API key in its environment can't change underneath you; Dependabot and
Renovate both update a SHA pin that carries a version comment.
`agbjordan/secureport-action@v1` also works, but `v1` is a moving tag and
follows every v1.x release.

To have Secureport run the scan instead of uploading one, set `mode: scan` and
drop `file` (needs `cli-version: '0.6.0'` or later):

```yaml
- uses: agbjordan/secureport-action@v1
  with:
    mode: scan
    cli-version: '0.6.0'
    target-id: target_your_target_id
    # wait: true      # optional — wait for the result so fail-on can gate the PR
    # fail-on: high   # needs wait: true
  env:
    SECUREPORT_API_KEY: ${{ secrets.SECUREPORT_API_KEY }}
    SECUREPORT_API_URL: ${{ vars.SECUREPORT_API_URL }}
```

**A scan does not wait by default.** A real scan takes minutes to tens of
minutes; a runner polling for it would spend your Actions minutes on our
compute. The job starts the run, writes its id to the job summary, sets
`outcome=started` and finishes — no report, no PR comment, no gate. `wait: true`
opts in, bounded by when the API says the scan will have ended by, priced in
your minutes by your choice.

**The API key is never a `with:` input** — the same reasoning as
`packages/cli/src/hosted.ts`'s module doc: a `with:` value is logged and
visible in the workflow file's rendered inputs, where a `secrets.*`-sourced
`env:` value is masked. Set it in the `env:` of the step above, and the
CLI reads it from the environment directly.

## Inputs

| Input         | Required | Default    | Notes                                                                                                                                                    |
| ------------- | -------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`        | no       | `upload`   | `upload` sends a file you already have; `scan` asks Secureport to scan the target — see above                                                            |
| `wait`        | no       | `false`    | `scan` only. Wait for the scan to end so the report, comment and `fail-on` can use it                                                                    |
| `cli-version` | **yes**  | —          | Exact `@secureport/cli` version, e.g. `0.2.0`. No ranges, no `latest`                                                                                    |
| `target-id`   | yes      | —          | Which Secureport target this run is against                                                                                                              |
| `file`        | upload   | —          | Path to the scanner output file. Refused with `scan`                                                                                                     |
| `engine`      | no       | detected   | `nuclei`, `zap`, `burp`, `nessus` or `generic`. `upload` only                                                                                            |
| `scope`       | no       | everything | Globs covered by this run, one per line. `upload` only — a scan records its own coverage                                                                 |
| `report-kind` | no       | `vap`      | `pen`, `vap`, `exec`, `attest` or `retest`                                                                                                               |
| `fail-on`     | no       | `none`     | Fail the job on a new/regressed issue at or above this severity. With `scan`, needs `wait: true`                                                         |
| `comment`     | no       | `true`     | Post a sticky PR comment, updated in place on every run. The job summary is always written; this only controls the comment                               |
| `sarif`       | no       | `false`    | Upload the run's open issues to GitHub code scanning as SARIF, so they appear inline on the diff. Needs `security-events: write` — see Permissions below |

## Outputs

| Output         | Meaning                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| `run-id`       | The run this Action started — an upload or a scan                       |
| `summary-path` | JSON file: the run summary. Empty for a scan nobody waited for          |
| `report-path`  | JSON file: `secureport report <kind> --run <id> --format json`'s output |
| `outcome`      | `passed`, `threshold-breached`, `action-required`, or `started`         |

`started` means a scan began and this job did not wait for it — `secureport
scan status <run-id>` shows where it is.

`action-required` means the API needs a person in the Secureport dashboard
first — the organisation hasn't accepted current terms, the target has no
passing verification, or the free scans are used up. None is something an API key can fix; go to the
dashboard, then re-run.

## The PR comment and job summary

Every run writes a job summary, and — on a `pull_request` event, unless
`comment: false` — a sticky PR comment: one comment per target, updated in
place rather than posted fresh each time. Both are rendered by
`secureport ci-summary`, the same typed function either way.

**Counts only, by design — permanently, not until something better ships.**
Neither surface ever names an issue's title or location. On a public
repository both are world-readable, and a list like "SQL injection at
`https://prod.example.com/login`" is an exploit map for a live target, not a
report. Per-issue detail belongs in code scanning — see SARIF upload below —
which only reaches people with access to it, unlike this comment.

A sample, for a run with something new:

```markdown
<!-- secureport:ci-summary:target_abc123 -->

**3 new (1 critical, 2 high) · 2 resolved · 1 regression caught · 41 fixed to date**

| Severity | New | Regressed | Resolved | Still open |
| -------- | --- | --------- | -------- | ---------- |
| critical | 1   | 0         | 0        | 4          |
| high     | 2   | 1         | 1        | 9          |
| medium   | 0   | 0         | 1        | 12         |
| low      | 0   | 0         | 0        | 3          |
| advisory | 0   | 0         | 0        | 1          |

**Severity gate failed:** a new or regressed issue at or above **high** — this job fails.

<sub>Run `run_abc123` · target Example App · vap report · nuclei</sub>
```

When nothing changed, both surfaces collapse to one line — "No change since
the last run · 41 fixed to date" — and the comment updates the existing one
in place without posting again.

## SARIF upload

With `sarif: true`, the run's currently-open issues are rendered as SARIF
2.1.0 and uploaded to GitHub code scanning
(`github/codeql-action/upload-sarif`), so each one appears inline on the
diff and in the repository's Security tab — a title and a location, the
detail the PR comment and job summary deliberately never show. Resolved and
suppressed issues never appear in the upload: SARIF is the input to GitHub's
own diffing, and including a resolved issue would tell GitHub the finding is
still open.

Uploads are scoped to this target (`category: secureport-<target-id>`), so
running the Action against more than one target in the same repository
does not have one target's upload overwrite another's alerts.

When the upload succeeds, the job summary and PR comment gain one more
footer line — "details in code scanning" — linking to the repository's
code-scanning tab. Still just a pointer: the comment's own counts-only shape
doesn't change.

## Permissions

The job summary needs nothing. The PR comment needs the calling workflow to
grant `permissions: pull-requests: write` (or the broader `issues: write` —
GitHub accepts either for comment reads and writes). `sarif: true` needs
`permissions: security-events: write`; on a private repository, also
`contents: read`. Neither missing permission fails the job on its own —
the PR comment step never throws, and the SARIF upload step runs with
`continue-on-error: true` — because the job summary above either already
carries the run's real result. Both failures are still visible: a `403` from
the PR comment is a warning in the log, and a failed SARIF upload step shows
red in the job's step list even though the job as a whole still passes.

## Fork PRs

On a `pull_request` event from a fork, `GITHUB_TOKEN` is read-only and
secrets are not passed to the job at all — so `SECUREPORT_API_KEY` is empty.
The Validate inputs step catches this before anything runs and fails with
`No credential on a fork PR`, naming the two options below, rather than
letting it surface later as a generic missing-credential error from the CLI.

This Action doesn't pick one of the two for you — `pull_request_target`
checks out untrusted code under a token that does carry secrets, and that
choice belongs to whoever owns the calling workflow, not to this Action.
Common ways to still run against fork PRs: `pull_request_target` (with the
usual caution about checking out untrusted code under it), or restricting
this Action to same-repository PRs —

```yaml
if: github.event.pull_request.head.repo.full_name == github.repository
```

## Exit codes this Action understands

Mirrors `@secureport/cli`'s own contract (`secureport --help`):

| Exit | Meaning                                                                                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------- |
| 0    | it worked                                                                                                               |
| 3    | `--fail-on` found a new or regressed issue at the floor — the run itself still succeeded, and the report still rendered |
| 4    | the API needs a person in the dashboard (terms, verification, scan quota) — `outcome=action-required`                   |

Anything else fails the step with the CLI's own error message.
