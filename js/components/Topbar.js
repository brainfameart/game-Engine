/**
 * Topbar.js
 * View title/subtitle on the left, contextual search + primary action
 * on the right. Content adapts to the active view.
 */
window.ZenTopbar = {
    titles: {
        projects: { title: 'Projects', sub: 'Recently opened workspaces' },
        learn: { title: 'Learn', sub: 'Guides, references and rendering techniques' },
        installs: { title: 'Installs', sub: 'Engine versions on this machine' }
    },

    render() {
        const { el } = window.ZenDom;
        const state = window.ZenStore.getState();
        const meta = this.titles[state.view] || this.titles.projects;

        const left = el('div', {}, [
            el('div', { class: 'tv-title' }, [meta.title]),
            el('div', { class: 'tv-sub' }, [meta.sub])
        ]);

        const right = el('div', { style: 'display:flex;align-items:center;gap:12px;' });

        if (state.view === 'projects') {
            const search = el('div', { class: 'search-field' }, [
                el('span', { html: '<svg data-lucide="search"></svg>' }),
                el('input', {
                    type: 'text',
                    placeholder: 'Search projects',
                    value: state.searchQuery,
                    oninput: (e) => window.ZenStore.setSearchQuery(e.target.value)
                })
            ]);
            const newBtn = el('button', {
                class: 'btn btn-primary',
                onClick: () => window.ZenStore.openModal()
            }, [
                el('span', { html: '<svg data-lucide="plus"></svg>' }),
                'New project'
            ]);
            right.append(search, newBtn);
        }

        const wrap = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;width:100%;' }, [left, right]);
        return wrap;
    }
};
