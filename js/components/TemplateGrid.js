/**
 * TemplateGrid.js
 * Selectable grid of starter templates, used inside NewProjectModal.
 */
window.ZenTemplateGrid = {
    render() {
        const { el } = window.ZenDom;
        const state = window.ZenStore.getState();

        const cards = window.ZenTemplates.map(tpl => {
            const selected = state.selectedTemplateId === tpl.id;
            return el('div', {
                class: 'template-card' + (selected ? ' selected' : ''),
                role: 'button',
                tabindex: '0',
                'aria-pressed': selected ? 'true' : 'false',
                onClick: () => window.ZenStore.selectTemplate(tpl.id)
            }, [
                el('div', { class: 'tpl-check' }, [el('span', { html: '<svg data-lucide="check"></svg>' })]),
                el('div', { class: 'tpl-icon' }, [el('span', { html: `<svg data-lucide="${tpl.icon}"></svg>` })]),
                el('div', { class: 'tpl-name' }, [tpl.name]),
                el('div', { class: 'tpl-desc' }, [tpl.description])
            ]);
        });

        return el('div', { class: 'template-grid' }, cards);
    }
};
