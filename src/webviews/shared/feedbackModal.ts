import { vscode } from './common';
import { Utils } from './utils';
import { Icons } from './icons';

export class FeedbackModal {
    private static isInitialized = false;
    private static container: HTMLElement | null = null;
    private static overlay: HTMLElement | null = null;

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
                <h2>Help & Feedback</h2>
                <button class="feedback-close" title="Close">${Icons.Cancel}</button>
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
                        <label>System Information</label>
                        <textarea id="feedbackSystemDetails" name="entry.1173041044" readonly rows="4"></textarea>
                    </div>

                    <div class="form-group">
                        <label>What brings you here today? *</label>
                        <div class="radio-group">
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
                        <label>Please describe your issue or suggestion *</label>
                        <textarea name="entry.1328099188" required rows="5" placeholder="Describe your issue, bug, feedback, or feature suggestion..."></textarea>
                    </div>

                    <div class="form-group">
                        <label>How satisfied are you overall? *</label>
                        <div class="linear-scale">
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
                        <label>Okay if I follow up?</label>
                        <input type="email" name="entry.1729939963" placeholder="your.email@example.com (optional)">
                    </div>
                </form>
            </div>

            <div class="feedback-footer">
                <button type="button" class="btn-cancel" id="feedbackCancelBtn">Cancel</button>
                <button type="submit" class="btn-submit" id="feedbackSubmitBtn" form="feedbackForm">Submit</button>
            </div>
        `;
        document.body.appendChild(this.container);

        this.bindEvents();

        // Listen for system details from extension
        window.addEventListener('message', (event) => {
            if (event.data.command === 'systemDetails') {
                const detailsArea = document.getElementById('feedbackSystemDetails') as HTMLTextAreaElement;
                if (detailsArea) {
                    const editorName = event.data.editorName || 'VS Code';
                    detailsArea.value = `Editor: ${editorName}\nVersion: ${event.data.vscodeVersion}\nExtension: ${event.data.extensionVersion}\nOS: ${event.data.osInfo}`;
                }
            } else if (event.data.command === 'feedbackResult') {
                const submitBtn = document.getElementById('feedbackSubmitBtn') as HTMLButtonElement;
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Submit';
                }
                if (event.data.ok) {
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
                url: 'https://github.com/nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor/issues/new'
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

        this.overlay?.classList.remove('hidden');
        this.container?.classList.remove('hidden');

        // Allow animation
        setTimeout(() => {
            this.overlay?.classList.add('active');
            this.container?.classList.add('active');
        }, 10);
    }

    public static hide() {
        this.overlay?.classList.remove('active');
        this.container?.classList.remove('active');

        setTimeout(() => {
            this.overlay?.classList.add('hidden');
            this.container?.classList.add('hidden');
        }, 300); // match transition duration
    }
}
