// Upserts one PR comment per target, keyed by a hidden marker embedded as
// the first line of the markdown (`secureport ci-summary`'s `marker`).
// `.cjs`, not `.js`: the repository root's package.json sets
// `"type": "module"`, and `actions/github-script`'s `require()` needs
// CommonJS. Plain Node, not TypeScript — action/ is not a pnpm workspace
// package (no package.json, no tsconfig), so there is nothing to compile it
// with.
//
// Never throws. A comment failure — most commonly a fork PR's read-only
// GITHUB_TOKEN, see action/README.md's "Fork PRs" section — becomes a
// warning, not a failed job: the job summary above it already carries the
// same markdown.
module.exports = async ({ github, context, core }, { marker, quiet, markdown }) => {
  const pr = context.payload.pull_request;
  if (!pr) {
    core.info('secureport: not a pull_request event, skipping the PR comment.');
    return;
  }

  try {
    const comments = await github.paginate(github.rest.issues.listComments, {
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: pr.number,
    });
    const existing = comments.find(
      (c) => c.user?.type === 'Bot' && typeof c.body === 'string' && c.body.includes(marker),
    );

    if (existing) {
      await github.rest.issues.updateComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        comment_id: existing.id,
        body: markdown,
      });
      return;
    }

    // A quiet run updates an existing comment (above) so it never goes
    // stale, but never creates a fresh one — nothing changed enough to be
    // worth a new notification.
    if (quiet) return;

    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: pr.number,
      body: markdown,
    });
  } catch (error) {
    core.warning(
      `secureport: could not post the PR comment (${error instanceof Error ? error.message : String(error)}). ` +
        "This needs `permissions: pull-requests: write`, which a fork PR's GITHUB_TOKEN never has. " +
        'The job summary above has the same result.',
    );
  }
};
