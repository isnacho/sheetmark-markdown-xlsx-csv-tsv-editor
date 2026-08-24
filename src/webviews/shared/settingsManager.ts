 
import { Icons } from './icons';
import {
    groupMenuSections,
    renderMenuCheckboxRow,
    renderMenuPanelShell,
    renderMenuSection
} from './menuPanel';

export interface SettingDefinition {
    id: string;
    label: string;
    onChange: (value: any) => void;
    defaultValue?: boolean;
    tooltip?: string;
    inputType?: 'checkbox' | 'radio';
    groupName?: string;
    value?: string;
    className?: string;
    section?: string;
    /** When set, renders this HTML instead of a checkbox/radio row (e.g. theme select). */
    html?: string;
}

export class SettingsManager {
    private openBtn: HTMLElement | null;
    private panel: HTMLElement | null;
    private cancelBtn: HTMLElement | null;
    private settings: SettingDefinition[];
    private repositionHandlers: any = null;
    private panelOriginalParent: Node | null = null;
    private panelOriginalNext: Node | null = null;
    private onReposition?: () => void;
    private escapeHandler: ((e: KeyboardEvent) => void) | null = null;

    constructor(buttonId: string, panelId: string, cancelId: string, settings: SettingDefinition[], onReposition?: () => void) {
        this.openBtn = document.getElementById(buttonId);
        this.panel = document.getElementById(panelId);
        this.cancelBtn = document.getElementById(cancelId);
        this.settings = settings;
        this.onReposition = onReposition;

        this.init();
    }

    private static renderSettingItem(s: SettingDefinition): string {
        if (s.html) {
            return s.html;
        }

        return renderMenuCheckboxRow({
            id: s.id,
            label: s.label,
            tooltip: s.tooltip,
            inputType: s.inputType,
            groupName: s.groupName,
            value: s.value,
            className: s.className
        });
    }

    static renderPanel(
        container: HTMLElement,
        panelId: string,
        cancelId: string,
        settings: SettingDefinition[],
        options: { title?: string } = {}
    ) {
        const panel = document.createElement('div');
        panel.id = panelId;
        panel.className = 'menu-panel settings-panel hidden';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-hidden', 'true');

        const title = options.title || 'Settings';
        const titleId = `${panelId}Title`;
        panel.setAttribute('aria-labelledby', titleId);

        const sections = groupMenuSections(settings);
        let bodyHtml = '<div class="settings-group">';

        sections.forEach((section) => {
            let rowsHtml = '';
            section.items.forEach((setting) => {
                rowsHtml += this.renderSettingItem(setting);
            });
            if (section.name) {
                bodyHtml += renderMenuSection(section.name, rowsHtml);
            } else {
                bodyHtml += rowsHtml;
            }
        });

        bodyHtml += '</div>';

        panel.innerHTML = renderMenuPanelShell({
            title,
            titleId,
            closeId: cancelId,
            closeIconHtml: Icons.Cancel,
            bodyHtml
        });
        container.appendChild(panel);
    }

    private init() {
        if (!this.openBtn || !this.panel) {return;}

        this.openBtn.addEventListener('click', () => {
            if (this.panel!.classList.contains('hidden')) {
                this.openPanel();
            } else {
                this.closePanel();
            }
        });

        if (this.cancelBtn) {
            this.cancelBtn.addEventListener('click', () => this.closePanel());
        }

        this.escapeHandler = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || this.panel!.classList.contains('hidden')) {return;}
            e.preventDefault();
            this.closePanel();
        };
        document.addEventListener('keydown', this.escapeHandler);

        // Wire up settings
        this.settings.forEach(setting => {
            if (setting.html) {
                return;
            }
            const el = document.getElementById(setting.id) as HTMLInputElement;
            if (el) {
                if (setting.defaultValue !== undefined) {
                    el.checked = setting.defaultValue;
                }
                el.addEventListener('change', () => {
                    if (setting.inputType === 'radio') {
                        if (el.checked) {
                            setting.onChange(el.value);
                        }
                    } else {
                        setting.onChange(el.checked);
                    }
                });
            }
        });

        // Close on click outside
        document.addEventListener('click', (e) => {
            if (!this.panel!.classList.contains('hidden')) {
                if (!(e.target as HTMLElement).closest('.settings-panel') &&
                    !(e.target as HTMLElement).closest('#' + this.openBtn!.id)) {
                    this.closePanel();
                }
            }
        });
    }

    private repositionPanel() {
        const container = document.querySelector('.toolbar');
        if (!container) {return;}
        const rect = container.getBoundingClientRect();
        const fmtToolbar = document.getElementById('formattingToolbar');
        let top = rect.bottom;
        if (fmtToolbar && !fmtToolbar.classList.contains('hidden')) {
            top = Math.max(top, fmtToolbar.getBoundingClientRect().bottom);
        }

        const margin = 8;
        const anchor = this.openBtn?.getBoundingClientRect() ?? rect;

        this.panel!.style.position = 'fixed';
        this.panel!.style.left = 'auto';
        this.panel!.style.top = top + 'px';
        this.panel!.style.width = '';
        this.panel!.style.minWidth = '';
        this.panel!.style.maxWidth = '';
        this.panel!.style.maxHeight = Math.max(120, window.innerHeight - top - margin) + 'px';
        this.panel!.style.overflow = 'hidden';
        this.panel!.style.zIndex = '200001';

        let right = Math.max(margin, window.innerWidth - anchor.right);
        this.panel!.style.right = right + 'px';

        const panelRect = this.panel!.getBoundingClientRect();
        if (panelRect.left < margin) {
            right = Math.max(margin, window.innerWidth - panelRect.width - margin);
            this.panel!.style.right = right + 'px';
        }

        const scroll = this.panel!.querySelector('.menu-panel__body') as HTMLElement | null;
        if (scroll) {
            scroll.style.maxHeight = Math.max(80, window.innerHeight - top - margin - 52) + 'px';
            scroll.style.overflowY = 'auto';
            scroll.style.overflowX = 'hidden';
        }

        if (this.onReposition) {this.onReposition();}
    }

    private openPanel() {
        // Save original parent so we can restore later
        if (!this.panelOriginalParent) {
            this.panelOriginalParent = this.panel!.parentNode;
            this.panelOriginalNext = this.panel!.nextSibling;
        }
        if (this.panel!.parentNode !== document.body) {
            document.body.appendChild(this.panel!);
        }

        this.panel!.classList.remove('hidden');
        this.panel!.classList.add('floating');
        this.panel!.setAttribute('aria-hidden', 'false');
        document.body.classList.add('settings-open');

        const container = document.querySelector('.toolbar');
        if (container) {
            container.classList.add('settings-open');
            // only expand the toolbar vertically when the toolbar is configured to be sticky
            // We check the body class for this state as it's usually managed by the consumer
            if (document.body.classList.contains('sticky-toolbar-enabled')) {
                container.classList.add('expanded-toolbar');
            }
        }

        this.repositionPanel();
        this.repositionHandlers = () => {
            this.repositionPanel();
        };
        window.addEventListener('resize', this.repositionHandlers);
        window.addEventListener('scroll', this.repositionHandlers, true);
    }

    private closePanel() {
        this.panel!.classList.add('hidden');
        this.panel!.classList.remove('floating');
        this.panel!.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('settings-open');

        const container = document.querySelector('.toolbar');
        if (container) {
            container.classList.remove('settings-open');
            // We can't easily know if sticky toolbar is disabled here without querying the checkbox
            // But usually the consumer handles the class removal on the container if needed
            // For safety, we remove expanded-toolbar if the body doesn't say it's enabled
            if (!document.body.classList.contains('sticky-toolbar-enabled')) {
                container.classList.remove('expanded-toolbar');
            }
        }

        this.panel!.style.position = '';
        this.panel!.style.left = '';
        this.panel!.style.top = '';
        this.panel!.style.width = '';
        this.panel!.style.minWidth = '';
        this.panel!.style.maxWidth = '';
        this.panel!.style.right = '';
        this.panel!.style.maxHeight = '';
        this.panel!.style.overflow = '';
        this.panel!.style.zIndex = '';

        const scroll = this.panel!.querySelector('.menu-panel__body') as HTMLElement | null;
        if (scroll) {
            scroll.style.maxHeight = '';
            scroll.style.overflowY = '';
            scroll.style.overflowX = '';
        }

        // Restore original parent/position
        if (this.panelOriginalParent && this.panelOriginalParent !== this.panel!.parentNode) {
            try {
                this.panelOriginalParent.insertBefore(this.panel!, this.panelOriginalNext);
            } catch (e) {
                this.panelOriginalParent.appendChild(this.panel!);
            }
        }

        if (this.repositionHandlers) {
            window.removeEventListener('resize', this.repositionHandlers);
            window.removeEventListener('scroll', this.repositionHandlers, true);
            this.repositionHandlers = null;
        }
    }
}
