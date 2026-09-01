/**
 * nav.js
 * Navigation from the launcher into the editor. The editor lives at
 * /zenengine/project/editor/index.html and is opened in the same frame
 * (replacing the launcher) so the React host stays put and no new tab
 * is opened. The project id/name is passed as a query param so the
 * editor can identify the open project; the store also records the
 * last-opened time so the project bubbles to the top of the list.
 */
window.ZenNav = {
    openEditor(project) {
        const params = new URLSearchParams();
        if (project && project.id) params.set('project', project.id);
        if (project && project.name) params.set('name', project.name);
        if (project && project.id) window.ZenStore.touchProject(project.id);
        const qs = params.toString();
        window.location.href = 'project/editor/index.html' + (qs ? '?' + qs : '');
    },
    backToHub() {
        window.location.href = '/zenengine/index.html';
    }
};
