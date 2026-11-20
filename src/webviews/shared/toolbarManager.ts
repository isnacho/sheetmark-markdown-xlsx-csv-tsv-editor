import { applyDelayedTitle, plainTooltipText, setDelayedTitleText } from './delayedTitleTooltip';

export interface ToolbarButton {
    id: string;
    icon: string; // SVG string
    label?: string;
    tooltip: string;
    onClick: () => void;
    enabled?: boolean;
    hidden?: boolean;
    cls?: string; // Extra classes
    section?: 'start' | 'end';
}

export class ToolbarManager {
    private container: HTMLElement;
    private buttons: Map<string, HTMLButtonElement> = new Map();
    private startGroup: HTMLElement | null = null;
    private endGroup: HTMLElement | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private isSticky: boolean = false;
    private headerHeightHook: (() => void) | null = null;
    private hoverRevealObserver: IntersectionObserver | null = null;
    private hoverRevealHotspot: HTMLElement | null = null;
    private hoverRevealWrapper: HTMLElement | null = null;
    private hoverRevealCompanion: HTMLElement | null = null;
    private hoverRevealHideTimer: number | undefined;
    private hoverRevealPointerInside = false;

    constructor(containerId: string) {
        const el = document.getElementById(containerId);
        if (!el) {throw new Error(`Toolbar container ${containerId} not found`);} 
        this.container = el;
        this.wireHoverRevealSurface(this.container);
    }

    private wireHoverRevealSurface(element: HTMLElement) {
        element.addEventListener('mouseenter', () => {
            this.hoverRevealPointerInside = true;
            this.cancelHoverRevealHide();
        });
        element.addEventListener('mouseleave', () => {
            this.hoverRevealPointerInside = false;
            this.scheduleHoverRevealHide();
        });
        element.addEventListener('focusin', () => {
            this.cancelHoverRevealHide();
            if (document.body.classList.contains('toolbar-hover-reveal-armed')) {
                this.updateHoverRevealHeight();
                document.body.classList.add('toolbar-hover-reveal-visible');
            }
        });
        element.addEventListener('focusout', () => this.scheduleHoverRevealHide());
    }

    /** Optional hook fired after each header-height recompute (e.g. MD formatting bar). */
    setHeaderHeightHook(hook: (() => void) | null) {
        this.headerHeightHook = hook;
    }

    setHoverRevealCompanion(element: HTMLElement | null) {
        if (!element || this.hoverRevealCompanion === element) {return;}
        this.hoverRevealCompanion = element;
        this.wireHoverRevealSurface(element);
    }

    private cancelHoverRevealHide() {
        if (this.hoverRevealHideTimer !== undefined) {
            window.clearTimeout(this.hoverRevealHideTimer);
            this.hoverRevealHideTimer = undefined;
        }
    }

    private hideHoverReveal() {
        this.cancelHoverRevealHide();
        document.body.classList.remove('toolbar-hover-reveal-visible');
    }

    private shouldRetainHoverReveal(): boolean {
        return this.hoverRevealPointerInside
            || this.container.contains(document.activeElement)
            || !!this.hoverRevealCompanion?.contains(document.activeElement)
            || document.querySelector('[data-toolbar-reveal-retain]:not(.hidden)') !== null;
    }

    private scheduleHoverRevealHide() {
        if (!document.body.classList.contains('toolbar-hover-reveal-visible')) {return;}
        this.cancelHoverRevealHide();
        this.hoverRevealHideTimer = window.setTimeout(() => {
            this.hoverRevealHideTimer = undefined;
            if (this.shouldRetainHoverReveal()) {
                this.scheduleHoverRevealHide();
                return;
            }
            document.body.classList.remove('toolbar-hover-reveal-visible');
        }, 750);
    }

    private updateHoverRevealHeight() {
        if (!this.hoverRevealWrapper) {return;}
        const mainHeight = Math.max(1, Math.ceil(this.container.getBoundingClientRect().height));
        const companionHeight = this.hoverRevealCompanion && !this.hoverRevealCompanion.classList.contains('hidden')
            ? Math.ceil(this.hoverRevealCompanion.getBoundingClientRect().height)
            : 0;
        const main = `${mainHeight}px`;
        const total = `${mainHeight + companionHeight}px`;
        this.hoverRevealWrapper.style.setProperty('--toolbar-hover-reveal-main-height', main);
        this.hoverRevealWrapper.style.setProperty('--toolbar-hover-reveal-height', total);
        document.documentElement.style.setProperty('--toolbar-hover-reveal-main-height', main);
        document.documentElement.style.setProperty('--toolbar-hover-reveal-height', total);
    }

    private setHoverRevealEnabled(enabled: boolean, wrapper: HTMLElement) {
        if (enabled && this.hoverRevealWrapper === wrapper && this.hoverRevealObserver) {
            this.updateHoverRevealHeight();
            return;
        }

        this.hoverRevealObserver?.disconnect();
        this.hoverRevealObserver = null;
        this.hoverRevealHotspot?.remove();
        this.hoverRevealHotspot = null;
        this.hoverRevealWrapper?.style.removeProperty('--toolbar-hover-reveal-height');
        this.hoverRevealWrapper?.style.removeProperty('--toolbar-hover-reveal-main-height');
        document.documentElement.style.removeProperty('--toolbar-hover-reveal-height');
        document.documentElement.style.removeProperty('--toolbar-hover-reveal-main-height');
        this.hoverRevealWrapper = null;
        this.hoverRevealPointerInside = false;
        this.hideHoverReveal();
        document.body.classList.remove('toolbar-hover-reveal-armed');

        if (!enabled || !window.matchMedia('(hover: hover)').matches) {return;}

        this.hoverRevealWrapper = wrapper;
        const hotspot = document.createElement('div');
        hotspot.className = 'toolbar-hover-reveal-hotspot';
        hotspot.setAttribute('aria-hidden', 'true');
        hotspot.addEventListener('mouseenter', () => {
            this.hoverRevealPointerInside = true;
            this.cancelHoverRevealHide();
            if (document.body.classList.contains('toolbar-hover-reveal-armed')) {
                this.updateHoverRevealHeight();
                document.body.classList.add('toolbar-hover-reveal-visible');
            }
        });
        hotspot.addEventListener('mouseleave', () => {
            this.hoverRevealPointerInside = false;
            this.scheduleHoverRevealHide();
        });
        document.body.appendChild(hotspot);
        this.hoverRevealHotspot = hotspot;

        this.hoverRevealObserver = new IntersectionObserver(([entry]) => {
            const armed = !entry.isIntersecting;
            if (armed) {
                this.updateHoverRevealHeight();
            } else {
                wrapper.style.removeProperty('--toolbar-hover-reveal-height');
                wrapper.style.removeProperty('--toolbar-hover-reveal-main-height');
                this.hideHoverReveal();
            }
            document.body.classList.toggle('toolbar-hover-reveal-armed', armed);
        });
        this.hoverRevealObserver.observe(wrapper);
    }

    applyStickyLayout(stickyToolbar: boolean, contentId: string = 'content', scrollQuery: string = '.table-scroll') {
        this.isSticky = stickyToolbar;
        const container = this.container;
        const wrapper = container.parentElement && container.parentElement.classList.contains('toolbar-wrapper')
            ? container.parentElement as HTMLElement
            : null;
        const layoutHost = wrapper || container;
        const content = document.getElementById(contentId);
        const scrollArea = document.querySelector(scrollQuery);
        const headerBg = document.querySelector('.header-background') as HTMLElement | null;

        container.classList.remove('hidden');
        container.style.removeProperty('display');
        if (!container.style.display) {
            container.style.display = 'flex';
        }

        if (stickyToolbar) {
            document.body.classList.add('sticky-toolbar-enabled');
            if (layoutHost.parentNode !== document.body) {
                if (content && content.parentNode === document.body) {
                    document.body.insertBefore(layoutHost, content);
                } else if (document.body.firstChild) {
                    document.body.insertBefore(layoutHost, document.body.firstChild);
                } else {
                    document.body.appendChild(layoutHost);
                }
            }
            container.classList.remove('not-sticky');
            container.classList.add('expanded-toolbar');
            if (headerBg) {headerBg.style.display = '';}

            if (!this.resizeObserver) {
                this.resizeObserver = new ResizeObserver(() => this.updateHeaderHeight());
                this.resizeObserver.observe(container);
            }
        } else {
            document.body.classList.remove('sticky-toolbar-enabled');
            const targetParent = content || document.body;
            const scrollElement = scrollArea instanceof HTMLElement ? scrollArea : null;
            if (targetParent) {
                if (scrollElement && scrollElement.parentElement === targetParent) {
                    if (layoutHost.parentNode !== targetParent || layoutHost.nextSibling !== scrollElement) {
                        targetParent.insertBefore(layoutHost, scrollElement);
                    }
                } else if (layoutHost.parentNode !== targetParent) {
                    targetParent.insertBefore(layoutHost, targetParent.firstChild);
                }
            }
            container.classList.add('not-sticky');
            container.classList.remove('expanded-toolbar');
            if (headerBg) {headerBg.style.display = 'none';}

            if (this.resizeObserver) {
                this.resizeObserver.disconnect();
                this.resizeObserver = null;
            }
        }
        this.setHoverRevealEnabled(!stickyToolbar, layoutHost);
        this.updateHeaderHeight();
    }

    updateHeaderHeight() {
        const headerBg = document.querySelector('.header-background') as HTMLElement | null;

        if (!this.isSticky) {
            document.documentElement.style.setProperty('--header-height', '0px');
            document.documentElement.style.setProperty('--main-toolbar-height', '0px');
            if (headerBg) {headerBg.style.height = '';}
            return;
        }

        let height = Math.max(6, Math.ceil(this.container.getBoundingClientRect().height));
        const maxHeightStr = getComputedStyle(document.documentElement).getPropertyValue('--header-height-max');
        const maxHeight = parseInt(maxHeightStr, 10) || 96;
        height = Math.min(height, maxHeight);

        document.documentElement.style.setProperty('--main-toolbar-height', height + 'px');
        document.documentElement.style.setProperty('--header-height', height + 'px');

        if (headerBg) {
            headerBg.style.height = height + 'px';
        }
        if (this.headerHeightHook) {
            this.headerHeightHook();
        }
    }

    setButtons(buttons: ToolbarButton[]) {
        this.container.innerHTML = '';
        this.buttons.clear();
        this.startGroup = null;
        this.endGroup = null;

        const hasEndSection = buttons.some(btn => btn.section === 'end');
        if (hasEndSection) {
            this.container.classList.add('toolbar-split');
            this.startGroup = document.createElement('div');
            this.startGroup.className = 'toolbar-group toolbar-group-start';
            this.endGroup = document.createElement('div');
            this.endGroup.className = 'toolbar-group toolbar-group-end';
            this.container.appendChild(this.startGroup);
            this.container.appendChild(this.endGroup);
        } else {
            this.container.classList.remove('toolbar-split');
        }

        buttons.forEach(btn => this.addButton(btn));
    }

    private getButtonParent(btn: ToolbarButton): HTMLElement {
        if (btn.section === 'end' && this.endGroup) {
            return this.endGroup;
        }
        if (this.startGroup) {
            return this.startGroup;
        }
        return this.container;
    }

    addButton(btn: ToolbarButton) {
        const wrapper = document.createElement('div');
        wrapper.className = `tooltip ${btn.cls || ''}`;
        if (btn.hidden) {wrapper.classList.add('hidden');}

        const buttonEl = document.createElement('button');
        buttonEl.id = btn.id;
        buttonEl.className = `toggle-button`;
        if (btn.enabled === false) {buttonEl.disabled = true;}
        
        if (btn.icon.trim().startsWith('<svg')) {
            buttonEl.innerHTML = btn.icon;
        } else {
            buttonEl.innerHTML = btn.icon;
        }

        if (btn.label) {
            const labelSpan = document.createElement('span');
            labelSpan.className = 'btn-label';
            labelSpan.textContent = btn.label;
            buttonEl.appendChild(document.createTextNode(' '));
            buttonEl.appendChild(labelSpan);
        }

        buttonEl.addEventListener('click', () => {
            btn.onClick();
        });

        wrapper.appendChild(buttonEl);
        this.getButtonParent(btn).appendChild(wrapper);
        this.buttons.set(btn.id, buttonEl);

        if (!btn.label && btn.tooltip) {
            applyDelayedTitle(buttonEl, plainTooltipText(btn.tooltip));
        }
    }

    setButtonEnabled(id: string, enabled: boolean) {
        const btn = this.buttons.get(id);
        if (btn) {btn.disabled = !enabled;}
    }

    setButtonVisibility(id: string, visible: boolean) {
        const btn = this.buttons.get(id);
        if (btn) {
            const wrapper = btn.closest('.tooltip');
            const target = wrapper || btn;
            if (visible) {target.classList.remove('hidden');}
            else {target.classList.add('hidden');}
        }
    }

    setButtonTooltip(id: string, tooltip: string) {
        const btn = this.buttons.get(id);
        if (btn) {
            setDelayedTitleText(btn, plainTooltipText(tooltip));
        }
    }

    setButtonsEnabled(enabled: boolean) {
        this.buttons.forEach(btn => {
            btn.disabled = !enabled;
        });
    }
    
    getButton(id: string): HTMLButtonElement | undefined {
        return this.buttons.get(id);
    }

    prependElement(element: HTMLElement) {
        const target = this.startGroup || this.container;
        if (target.firstChild) {
            target.insertBefore(element, target.firstChild);
        } else {
            target.appendChild(element);
        }
    }
}
