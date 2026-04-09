# Obsidian Setup for wiki-recall

wiki-recall uses [Obsidian](https://obsidian.md) as the visual interface for your `~/.grain/` knowledge base. This guide covers installation and vault registration.

## Prerequisites

- [Obsidian](https://obsidian.md) downloaded and installed
- `~/.grain/` directory created (run `scripts/setup.ps1` first)

## Automatic Setup

The setup wizard (`scripts/setup.ps1`) automatically:
1. Detects if Obsidian is installed
2. Registers `~/.grain/` as an Obsidian vault
3. Copies `.obsidian/` config for wiki-recall-optimized settings

If Obsidian is installed, this should just work.

## Manual Setup (Fallback)

If automatic registration fails — or if you installed Obsidian after running setup — you can register the vault manually:

1. Open Obsidian
2. Click **"Open folder as vault"** (on the vault picker screen)
3. Navigate to your home directory and select the `.grain` folder
   - Windows: `C:\Users\<you>\.grain`
   - macOS/Linux: `~/.grain`
4. Click **Open**

Your knowledge base is now browsable in Obsidian.

## Recommended Plugins

wiki-recall works with vanilla Obsidian, but these community plugins improve the experience:

| Plugin | Why |
|:-------|:----|
| **Dataview** | Query your wiki pages like a database |
| **Calendar** | Visual timeline of wiki changes |
| **Graph Analysis** | Explore connections between entities |

## Graph View Color Coding

Open the graph view with `Ctrl+G` (or `Cmd+G` on macOS). The shipped `.obsidian/graph.json` config color-codes nodes by knowledge category:

| Color | Query | What it shows |
|:------|:------|:--------------|
| **Blue** (`#55AAFF`) | `path:wiki/projects` | Project pages |
| **Light blue** (`#7ED4FF`) | `path:wiki/concepts` | Concept/technology pages |
| **Orange** (`#F08037`) | `path:wiki/patterns` | Bug patterns and workarounds |
| **Teal** (`#22A8F6`) | `path:domains` | Domain context files |

Uncolored nodes are other files (brain.md, decisions.md, actions.md, etc.).

Graph settings include tags visible, directional arrows, and orphan detection. Customize via the gear icon in graph view or by editing `~/.grain/.obsidian/graph.json`.

## Troubleshooting

### "Vault not found" when opening via URI

This happens when the vault isn't registered in Obsidian's config. Fix:

1. Open Obsidian normally (not via URI)
2. Use "Open folder as vault" → select `~/.grain`
3. The vault is now registered and URI links will work

### `.obsidian/` folder missing

Re-run setup or copy manually:

```bash
cp -r path/to/wiki-recall/.obsidian ~/.grain/.obsidian
```

### Obsidian not installed

Download from [obsidian.md](https://obsidian.md). wiki-recall works without Obsidian — it's optional but recommended for browsing your wiki visually.
