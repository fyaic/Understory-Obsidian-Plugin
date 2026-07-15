const { Modal, MarkdownRenderer } = require('obsidian');

const MAX_LOG_ENTRIES = 200;
const MAX_PROCESS_OUTPUT_BYTES = 5 * 1024 * 1024;

// 在弹窗里渲染 .understory/ 隐藏目录内容（vault API 无法打开点前缀目录）。
// content 可以是 markdown 字符串（用 MarkdownRenderer 渲染），也可以是 (wrap, modal)=>void 构建函数（支持可点击 DOM）。
class GraphifyContentModal extends Modal {
    constructor(app, plugin, titleText, content) {
        super(app);
        this.plugin = plugin;
        this.titleText = titleText;
        this.content = content;
    }
    onOpen() {
        const { contentEl, titleEl, modalEl } = this;
        titleEl.setText(this.titleText);
        modalEl.addClass?.('understory-content-modal');
        const wrap = contentEl.createDiv({ cls: 'understory-content-modal-body' });
        if (typeof this.content === 'function') {
            this.content(wrap, this);
        } else {
            try {
                MarkdownRenderer.renderMarkdown(String(this.content), wrap, '.understory/', this);
            } catch {
                wrap.createEl('pre', { text: String(this.content) });
            }
        }
    }
    onClose() { this.contentEl.empty(); }
}

module.exports = { GraphifyContentModal, MAX_LOG_ENTRIES, MAX_PROCESS_OUTPUT_BYTES };
