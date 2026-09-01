/**
 * ProjectCard.js
 * A single row in the recent-projects list: thumbnail, name, template
 * tag, and last-opened time. Clicking the row opens the project in the
 * editor; the trash action deletes it from the launcher.
 */
window.ZenProjectCard = {
    render(project) {
        const { el } = window.ZenDom;

        const thumb = el('div', { class: 'project-thumb' }, [
            el('span', { html: '<svg data-lucide="image"></svg>' })
        ]);

        const meta = el('div', { class: 'project-meta' }, [
            el('div', { class: 'project-name' }, [project.name]),
            el('div', { class: 'project-path' }, [project.template || 'Blank Canvas'])
        ]);

        const tags = el('div', { class: 'project-tags' }, [
            el('span', { class: 'tag tag-version' }, [project.version]),
            el('span', { class: 'tag' }, [project.platform])
        ]);

        const opened = el('div', { class: 'project-opened' }, [window.ZenFormat.timeAgo(project.lastOpened)]);

        const delBtn = el('button', {
            class: 'btn btn-icon btn-danger-soft',
            title: 'Delete project',
            'aria-label': 'Delete project',
            onClick: (e) => {
                e.stopPropagation();
                if (confirm('Delete "' + project.name + '"? This removes it from your projects.')) {
                    window.ZenStore.deleteProject(project.id);
                }
            }
        }, [el('span', { html: '<svg data-lucide="trash-2"></svg>' })]);

        const actions = el('div', { class: 'project-row-actions' }, [delBtn]);

        const openProject = () => window.ZenNav.openEditor(project);

        return el('div', {
            class: 'project-row',
            role: 'button',
            tabindex: '0',
            title: 'Open ' + project.name,
            onClick: openProject,
            onKeydown: (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openProject();
                }
            }
        }, [thumb, meta, tags, opened, actions]);
    }
};
