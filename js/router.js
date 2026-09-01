/**
 * router.js
 * Maps the current store view name to a view-content renderer.
 * Not a URL router — this launcher has no navigable history, just
 * in-memory tab state, so this simply resolves state.view -> component.
 */
window.ZenRouter = {
    resolve(view) {
        switch (view) {
            case 'projects':
                return window.ZenProjectList.render();
            case 'learn':
                return window.ZenLearnView.render();
            case 'installs':
                return window.ZenInstallsView.render();
            default:
                return window.ZenProjectList.render();
        }
    }
};
