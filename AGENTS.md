# Project workflow rules

<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work in `projects/content-video-automation/`, read `projects/content-video-automation/antislop.md` and then the relevant skill:
- UI / visual: `projects/content-video-automation/skills/antislop-ui/SKILL.md`
- Copy & text: `projects/content-video-automation/skills/antislop-copywriting/SKILL.md`
- Accessibility: `projects/content-video-automation/skills/antislop-human/SKILL.md`
- Responsive layout: `projects/content-video-automation/skills/antislop-layoutmobile/SKILL.md`
- Code comments: `projects/content-video-automation/skills/antislop-code/SKILL.md`

The user deferred UI changes until later. Use DURING mode for a future UI implementation unless the user explicitly selects another mode for that session.
<!-- antislop:end -->
- For every requested code/configuration change, complete relevant tests and build before delivery.
- Then commit the changes with a Conventional Commit message and push to the current branch's configured remote; sync with `git pull --rebase` first when safe. Never force-push, rewrite shared history, or include unrelated user changes.
- Deploy after a successful build when this project has a clearly configured deployment target and credentials/permissions are available. Verify health/live behavior. If deployment is not configured or fails, report that clearly; never claim it is live.
- Do not expose secrets; do not commit credentials, generated data, or unrelated files. For questions/discussion without requested changes, do not build, commit, push, or deploy.
