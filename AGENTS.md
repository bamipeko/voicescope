# AGENTS.md

## Project
- Name: voicescape
- Agent: codex
- Chat: 

## Local Instructions
- Follow the shared instructions in `Z:\projects\AGENTS.md`.
- Keep project-specific decisions, commands, and caveats here as they appear.

## Windows / Z Drive Shell Notes
- Projects are expected to live under `Z:\projects`.
- In Codex desktop, sandboxed shell commands may fail when a mapped `Z:\` path is used as the working directory, even when the same path works in normal PowerShell.
- If a command fails with `CreateProcessWithLogonW failed: 267`, `The directory name is invalid`, or a similar working-directory error, treat it as a sandbox/mapped-drive issue first.
- Retry necessary commands with elevated sandbox permissions, or run from a local working directory while using absolute `Z:\...` paths.
- Do not debug the project, npm, Node.js, or the target file until this has been ruled out.

