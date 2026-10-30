# pr-guide

A guided tour of a pull request, written by your own Claude or Codex. The flow, prompt and tour layout come from t3code's review guides.

```sh
npx /path/to/pr-guide 27                 # PR #27 of the repo you're in
npx /path/to/pr-guide <PR or MR URL>     # from anywhere
npx /path/to/pr-guide 27 --md > tour.md  # headless (also the default when piped)
```

Tour keys: `j`/`k` stops · `↑↓` `space` `b` scroll · `1-9` jump · `f` file diffs · `o` open PR · `r` rewrite · `s` settings · `q` quit.

Needs `gh` or `glab`, and `claude` or `codex`, each logged in. The agent runs read-only in a temporary worktree at the PR head. If you're inside a clone of the repo, that clone is used; otherwise a blobless clone is cached in the system temp folder.

Guides are saved per PR in the system temp folder (`$TMPDIR/pr-guide`), so a restart clears them. Settings (harness, model, reasoning, speed) are in `~/.config/pr-guide/settings.json`.
