# AGENTS.md

## Project
- Name: voicescape
- Agent: codex
- Chat: 

## Local Instructions
- Follow the shared instructions in `$env:WORKSPACE_ROOT\AGENTS.md`.
- Keep project-specific decisions, commands, and caveats here as they appear.

## Managed Workspace Notes
- Development projects live under the user-level WORKSPACE_ROOT. Resolve it from the environment instead of hard-coding a drive letter.
- The NAS projects share is a guarded mirror and runtime/data location. Do not edit source code there directly.
- Use repository-relative paths in committed code and documentation.
- If an older task still uses the mapped-drive project path, checkpoint it and move the work to WORKSPACE_ROOT before continuing.

