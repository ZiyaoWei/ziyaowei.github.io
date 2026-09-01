# CLAUDE.md

## Git commit authorship

Author commits as the repo owner, not as Claude:

```
Ziyao Wei <ziyao.wei.wzy@gmail.com>
```

Add Claude as a co-author trailer instead of the author:

```
Co-Authored-By: Claude <noreply@anthropic.com>
```

## Amend by default

Keep folding follow-up work into the existing commit with `git commit --amend`
(and `git push --force-with-lease`). Only start a new commit when the repo owner
explicitly asks for one.
