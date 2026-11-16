import type { CommonHostToWebview } from '../../protocol/common';
import { vscode } from './common';
import { Utils } from './utils';
import { Icons } from './icons';
import { DialogKeyboard } from './popupFocus';

export class FeedbackModal {
    private static isInitialized = false;
    private static container: HTMLElement | null = null;
    private static overlay: HTMLElement | null = null;
    private static keyboard: DialogKeyboard | null = null;
    private static hideTimer: ReturnType<typeof setTimeout> | null = null;

    public static initialize() {
        if (this.isInitialized) {return;}
        this.isInitialized = true;

        this.overlay = document.createElement('div');
        this.overlay.className = 'feedback-overlay hidden';
        document.body.appendChild(this.overlay);

        this.container = document.createElement('div');
        this.container.className = 'feedback-modal hidden';
        this.container.innerHTML = `
            <div class="feedback-header">
                <h2 id="feedbackTitle">Help &amp; Feedback</h2>
                <button type="button" class="feedback-close" title="Close" aria-label="Close">${Icons.Cancel}</button>
            </div>
            <div class="feedback-body">
                <div class="github-section">
                    <p>For issues requiring follow-up or detailed discussion, we recommend creating a GitHub issue. This allows for better tracking and collaboration.</p>
                    <a class="github-issue-btn" href="#" id="githubIssueBtn">
                        <span>Create Issue on GitHub</span>
                    </a>
                </div>
                
                <form id="feedbackForm">
                    <div class="form-group">
                        <label for="feedbackSystemDetails">System Information</label>
                        <textarea id="feedbackSystemDetails" name="entry.1173041044" readonly rows="4"></textarea>
                    </div>

                    <div class="form-group">
                        <label id="feedbackReasonLabel">What brings you here today? *</label>
                        <div class="radio-group" role="radiogroup" aria-labelledby="feedbackReasonLabel">
                            <label class="radio-label">
                                <input type="radio" name="entry.500729934" value="Found a bug/issue" required>
                                <span>Found a bug/issue</span>
                            </label>
                            <label class="radio-label">
                                <input type="radio" name="entry.500729934" value="Got an idea" required>
                                <span>Got an idea</span>
                            </label>
                            <label class="radio-label">
                                <input type="radio" name="entry.500729934" value="General feedback" required>
                                <span>General feedback</span>
                            </label>
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="feedbackDescription">Please describe your issue or suggestion *</label>
                        <textarea id="feedbackDescription" name="entry.1328099188" required rows="5" placeholder="Describe your issue, bug, feedback, or feature suggestion..."></textarea>
                    </div>

                    <div class="form-group">
                        <label id="feedbackSatisfactionLabel">How satisfied are you overall? *</label>
                        <div class="linear-scale" role="radiogroup" aria-labelledby="feedbackSatisfactionLabel">
                            <span>Very Dissatisfied</span>
                            <label><input type="radio" name="entry.2123855879" value="1" required> 1</label>
                            <label><input type="radio" name="entry.2123855879" value="2" required> 2</label>
                            <label><input type="radio" name="entry.2123855879" value="3" required> 3</label>
                            <label><input type="radio" name="entry.2123855879" value="4" required> 4</label>
                            <label><input type="radio" name="entry.2123855879" value="5" required> 5</label>
                            <span>Very Satisfied</span>
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="feedbackEmail">Okay if I follow up?</label>
                        <input id="feedbackEmail" type="email" name="entry.1729939963" placeholder="your.email@example.com (optional)">
                    </div>
                </form>
            </div>

            <div class="feedback-footer">
                <button type="button" class="btn-cancel" id="feedbackCancelBtn">Cancel</button>
                <button type="submit" class="btn-submit" id="feedbackSubmitBtn" form="feedbackForm">Submit</button>
            </div>
        `;
        document.body.appendChild(this.container);
        this.keyboard = new DialogKeyboard(this.container, {
            modal: true,
            labelledBy: 'feedbackTitle',
            requestClose: () => this.hide(),
        });

        this.bindEvents();

        // Listen for system details from extension
        window.addEventListener('message', (event) => {
            const message = event.data as CommonHostToWebview;
            if (!('command' in message)) { return; }
            if (message.command === 'systemDetails') {
                const detailsArea = document.getElementById('feedbackSystemDetails') as HTMLTextAreaElement;
                if (detailsArea) {
                    const editorName = message.editorName || 'VS Code';
                    detailsArea.value = `Editor: ${editorName}\nVersion: ${message.vscodeVersion}\nExtension: ${message.extensionVersion}\nOS: ${message.osInfo}`;
                }
            } else if (message.command === 'feedbackResult') {
                const submitBtn = document.getElementById('feedbackSubmitBtn') as HTMLButtonElement;
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Submit';
                }
                if (message.ok) {
                    Utils.showToast('Feedback submitted successfully!');
                    this.hide();
                    const form = document.getElementById('feedbackForm') as HTMLFormElement;
                    if (form) {form.reset();}
                } else {
                    Utils.showToast('Failed to submit feedback.', false);
                }
            }
        });
    }

    private static bindEvents() {
        const closeBtn = this.container?.querySelector('.feedback-close');
        const cancelBtn = document.getElementById('feedbackCancelBtn');
        const overlay = this.overlay;

        const close = () => this.hide();
        closeBtn?.addEventListener('click', close);
        cancelBtn?.addEventListener('click', close);
        overlay?.addEventListener('click', close);

        const githubBtn = document.getElementById('githubIssueBtn');
        githubBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            vscode.postMessage({
                command: 'openExternal',
                url: 'https://github.com/isnacho/sheetmark-markdown-xlsx-csv-tsv-editor/issues/new'
            });
        });

        const form = document.getElementById('feedbackForm') as HTMLFormElement;

        form?.addEventListener('submit', (e) => {
            e.preventDefault();

            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            this.submitForm(form);
        });
    }

    private static submitForm(form: HTMLFormElement) {
        const submitBtn = document.getElementById('feedbackSubmitBtn') as HTMLButtonElement;
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Submitting...';
        }

        const formData = new FormData(form);
        const data: Record<string, string> = {};
        formData.forEach((value, key) => {
            data[key] = value.toString();
        });

        vscode.postMessage({
            command: 'submitFeedback',
            data
        });
    }

    public static show() {
        if (!this.isInitialized) {
            this.initialize();
        }

        // Request system details
        vscode.postMessage({ command: 'getSystemDetails' });

        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
        this.overlay?.classList.remove('hidden');
        this.container?.classList.remove('hidden');
        this.keyboard?.opened();

        // Allow animation
        setTimeout(() => {
            this.overlay?.classList.add('active');
            this.container?.classList.add('active');
        }, 10);
    }

    public static hide() {
        if (!this.container || this.container.classList.contains('hidden')) { return; }
        this.overlay?.classList.remove('active');
        this.container.classList.remove('active');
        this.keyboard?.closed();

        this.hideTimer = setTimeout(() => {
            this.hideTimer = null;
            this.overlay?.classList.add('hidden');
            this.container?.classList.add('hidden');
        }, 300); // match transition duration
    }
}
