# Getting started

This guide takes you from a fresh computer to Brad running in your browser. You don't need any programming experience. You only need to copy the commands into a terminal.

## 1. Open a terminal

- **macOS:** open the **Terminal** app (press `Cmd + Space` and type "Terminal"), or use the terminal inside VS Code (**Terminal → New Terminal**).
- **Windows:** open **PowerShell** from the Start menu.
- **Linux:** open your distribution's terminal app.

## 2. Install Node.js (version 22.13 or newer)

Check whether you already have it:

```bash
node -v
```

If the output is `v22.13.0` or higher, go to step 3. If you see `command not found` or an older version, install Node.js:

- **All systems:** download the **LTS** installer from <https://nodejs.org> and run it.
- **macOS with Homebrew:** `brew install node@22`
- **Windows with winget:** `winget install OpenJS.NodeJS.LTS`

Close the terminal, open a new one and run `node -v` again to confirm.

> **Using Anaconda/Miniconda?** If your prompt starts with `(base)`, conda may put its own older Node.js first. Run `conda deactivate` and check `node -v` again.

## 3. Install pnpm

Brad uses [pnpm](https://pnpm.io) to install its dependencies. It ships with Node.js through Corepack, so you only need to turn it on:

```bash
corepack enable
corepack prepare pnpm@10.17.1 --activate
pnpm -v
```

`pnpm -v` should print a version number.

If `corepack enable` fails:

- **Permission error on macOS/Linux:** run `sudo corepack enable` and type your computer password.
- **`corepack: command not found`:** install pnpm with npm instead: `npm install -g pnpm@10.17.1`
- **macOS with Homebrew:** `brew install pnpm` also works.

## 4. Download Brad

If you have [Git](https://git-scm.com/downloads):

```bash
git clone https://github.com/mayarapaolini/brad-open-source.git
cd brad-open-source
```

No Git? On the [repository page](https://github.com/mayarapaolini/brad-open-source), click **Code → Download ZIP** and unzip it. Then open a terminal inside the unzipped folder, or `cd` into it.

Run `ls` (macOS/Linux) or `dir` (Windows). You should see `package.json` and `pnpm-workspace.yaml`. Every command from here on must be run inside this folder.

## 5. Install and start

```bash
pnpm install
pnpm dev
```

The first `pnpm install` can take a few minutes. Leave `pnpm dev` running. It keeps Brad running for as long as the terminal is open.

## 6. Open Brad

Go to <http://127.0.0.1:5173> in your browser and click **Load demo profile**.

To stop Brad, go back to the terminal and press `Ctrl + C`. To start it again later, open a terminal in the same folder and run `pnpm dev`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `command not found: pnpm` | Step 3 was skipped or failed. Run `corepack enable`, or `npm install -g pnpm@10.17.1`, then open a new terminal. |
| `command not found: node` or `npm` | Node.js isn't installed or the terminal was opened before installing. Do step 2 and open a new terminal. |
| `Unsupported engine` or errors mentioning the Node version | Your Node.js is older than 22.13. Install the current LTS (step 2). If you use conda, run `conda deactivate`. |
| `ERR_PNPM_NO_PKG_MANIFEST` / `No package.json found` | You're in the wrong folder. `cd` into `brad-open-source` (step 4). |
| `cd: no such file or directory` | Check the folder name with `ls`/`dir` and use the exact name. |
| `EADDRINUSE` / port already in use | Brad (or another app) is already running. Close the other terminal or press `Ctrl + C` there, then run `pnpm dev` again. |
| Page doesn't load | Make sure `pnpm dev` is still running and use `http://127.0.0.1:5173`. |
| `No such built-in module: node:sqlite` | Your Node.js is too old. Brad uses the SQLite built into Node.js 22.13+. Update Node.js (step 2). |

Still stuck? [Open an issue](https://github.com/mayarapaolini/brad-open-source/issues) and paste the output of `node -v`, `pnpm -v` and the command that failed.
