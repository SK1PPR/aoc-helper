import * as vscode from 'vscode';
import { randomBytes } from 'crypto';

const BASE_CSS = `
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    line-height: 1.6;
    padding: 0 20px 48px;
    max-width: 920px;
  }
  header {
    position: sticky; top: 0; z-index: 1;
    display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
    padding: 10px 0; margin-bottom: 8px;
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  button, select {
    font: inherit; border: none; border-radius: 2px; padding: 4px 10px; cursor: pointer;
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  select {
    color: var(--vscode-dropdown-foreground);
    background: var(--vscode-dropdown-background);
    border: 1px solid var(--vscode-dropdown-border, transparent);
  }
  a { color: var(--vscode-textLink-foreground); }
  a:hover { color: var(--vscode-textLink-activeForeground); }
  code {
    font-family: var(--vscode-editor-font-family);
    font-size: 0.95em;
    background: var(--vscode-textCodeBlock-background);
    padding: 0 3px; border-radius: 3px;
  }
  pre { background: var(--vscode-textCodeBlock-background); padding: 10px 12px; border-radius: 4px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  .spacer { flex: 1; }
  .muted { color: var(--vscode-descriptionForeground); }
  .error { color: var(--vscode-errorForeground); }
  .gold { color: var(--vscode-charts-yellow); }
  .silver { color: var(--vscode-descriptionForeground); }
  .none { color: var(--vscode-disabledForeground); opacity: 0.5; }
`;

// Buttons and selects carrying data-cmd post their command back to the extension.
const BASE_SCRIPT = `
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', (e) => {
    const el = e.target.closest('button[data-cmd]');
    if (!el) return;
    e.preventDefault();
    const msg = { cmd: el.dataset.cmd };
    if (el.dataset.level) msg.level = Number(el.dataset.level);
    if (el.dataset.value) msg.value = Number(el.dataset.value);
    vscode.postMessage(msg);
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.cmd) vscode.postMessage({ cmd: el.dataset.cmd, value: Number(el.value) });
  });
`;

export function webviewHtml(webview: vscode.Webview, body: string, css = '', script = ''): string {
  const nonce = randomBytes(16).toString('base64');
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    'img-src https: data:',
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>${BASE_CSS}${css}</style>
</head>
<body>
${body}
<script nonce="${nonce}">${BASE_SCRIPT}${script}</script>
</body>
</html>`;
}
