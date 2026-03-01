---
name: n8n-tool
description: Synchronize n8n workflows as declarative JSON via the Decoupled Skill Service. Use this to backup, version control, or deploy automation logic headlessly.
allowed-tools: Bash(pw-sync:*)
---

# n8n Workflow Synchronization

The `n8n-tool` (via the `pw-sync` CLI) allows you to push and pull n8n workflows directly from your container. This enables a "GitOps" approach to automation where workflows are treated as code assets.

## Commands

### List Available Tools
Verify connectivity and see what tools are registered in the Decoupled Skill Layer.
```bash
pw-sync list-tools
```

### Export a Workflow
Pull a workflow from n8n and save it as a local JSON file.
```bash
pw-sync n8n export <workflow-id> > my-workflow.json
```

### Import a Workflow
Deploy a local JSON file as a new workflow or update an existing one.
```bash
# Deploy as a new workflow
pw-sync n8n import my-workflow.json

# Update an existing workflow by ID
pw-sync n8n import my-workflow.json <workflow-id>
```

## Internal Workflow

1. Use `pw-sync n8n export <id>` to retrieve existing logic.
2. Modify the JSON locally if needed (e.g., updating parameters or logic).
3. Use `pw-sync n8n import <path>` to deploy the changes back to n8n.
4. Verify deployment via the n8n UI or by triggering the workflow.

## Security Note

All synchronization happens over the internal `core-net` Docker network. The `pw-sync` tool uses a Pre-Shared Key (PSK) for authentication, which is automatically provided to your environment.
