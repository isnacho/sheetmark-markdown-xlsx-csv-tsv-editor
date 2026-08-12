export function renderThemeToggleSettingItem(selectId: string): string {
    return `<div class="setting-item theme-setting-item"><span>Theme</span><select id="${selectId}" class="theme-select" title="Theme"><option value="vscode">VS Code</option><option value="light">Light</option><option value="dark">Dark</option></select></div>`;
}

export interface ThemeManagerOptions {
    persistKey?: string;
    onBeforeCycle?: () => boolean | void;
}

export class ThemeManager {
    private select: HTMLSelectElement | null;
    private vscodeApi: any;
    private options: ThemeManagerOptions;

    constructor(selectId: string, options: ThemeManagerOptions = {}, vscodeApi: any = null) {
        this.select = document.getElementById(selectId) as HTMLSelectElement | null;
        this.vscodeApi = vscodeApi;
        this.options = {
            persistKey: 'last_used_theme',
            ...options
        };

        this.init();
    }

    private init() {
        if (!this.select) {
            return;
        }

        // Listen for theme messages from VS Code so vscode-theme mode follows host changes.
        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg && msg.type === 'setTheme') {
                this.handleVsCodeThemeChange(msg.kind);
            }
        });

        this.select.addEventListener('change', () => {
            if (typeof this.options.onBeforeCycle === 'function' && this.options.onBeforeCycle() === false) {
                this.syncSelectValue();
                return;
            }

            this.applyTheme(this.normalizeTheme(this.select!.value));
        });

        this.applyTheme(this.getStoredTheme(), false);
    }

    private normalizeTheme(value: string): 'light' | 'dark' | 'vscode' {
        if (value === 'dark' || value === 'light' || value === 'vscode') {
            return value;
        }
        return 'vscode';
    }

    private getStoredTheme(): 'light' | 'dark' | 'vscode' {
        if (this.vscodeApi && typeof this.vscodeApi.getState === 'function') {
            const state = this.vscodeApi.getState();
            if (state && typeof state.theme === 'string') {
                return this.normalizeTheme(state.theme);
            }
        }

        try {
            const lastUsed = localStorage.getItem(this.options.persistKey!);
            if (lastUsed) {
                return this.normalizeTheme(lastUsed);
            }
        } catch {
            // ignore
        }

        return 'vscode';
    }

    private setStoredTheme(theme: 'light' | 'dark' | 'vscode') {
        if (this.vscodeApi && typeof this.vscodeApi.getState === 'function') {
            const state = this.vscodeApi.getState() || {};
            state.theme = theme;
            this.vscodeApi.setState(state);
        }

        try {
            localStorage.setItem(this.options.persistKey!, theme);
        } catch {
            // ignore
        }
    }

    private applyTheme(theme: 'light' | 'dark' | 'vscode', save = true) {
        document.body.classList.remove('dark-mode', 'vscode-theme');

        if (theme === 'dark') {
            document.body.classList.add('dark-mode');
        } else if (theme === 'vscode') {
            document.body.classList.add('vscode-theme');
        }

        if (save) {
            this.setStoredTheme(theme);
        }

        this.syncSelectValue(theme);
    }

    private syncSelectValue(theme = this.getStoredTheme()) {
        if (!this.select) {
            return;
        }

        this.select.value = theme;
    }

    private handleVsCodeThemeChange(_kind: number) {
        if (this.getStoredTheme() === 'vscode') {
            this.applyTheme('vscode', false);
        }
    }
}
