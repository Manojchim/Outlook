# Git remotes — Dummy vs Outlook

## Critical finding

`Manojchim/Dummy` and `Manojchim/Outlook` have **unrelated Git histories** (no shared merge-base).  
Do **not** `git pull` / merge them together or force-push one history onto the other.

## Intended Actions target

| Item | Value |
|---|---|
| Actions / artifacts / run URLs | `https://github.com/Manojchim/Outlook` |
| Branch | `main` |
| Example run URL | `https://github.com/Manojchim/Outlook/actions/runs/<RUN_ID>` |

## Recommended remote layout (this workspace)

```text
origin   → https://github.com/Manojchim/Dummy.git     (legacy; preserve)
outlook  → https://github.com/Manojchim/Outlook.git   (Actions target)
```

Commands (already applied in the Stride_New clone):

```bash
git remote add outlook https://github.com/Manojchim/Outlook.git
git fetch outlook main
```

## Safe integration approach

1. Keep Dummy history on `origin` / `feature/manoj` (preserve local uncommitted work there).
2. Work Outlook changes on a branch **based on `outlook/main`** (e.g. git worktree).
3. Push only to `outlook` remote when authorized:
   `git push -u outlook HEAD:main` (or open a PR into Outlook `main`).
4. Never push QA Actions workflow changes to Dummy as the production Actions target.

## Worktree used for Outlook hardening

```text
../Stride_Outlook_main  (branch chore/outlook-qa-hardening from outlook/main)
```
