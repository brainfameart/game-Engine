/**
 * main.js
 * Application bootstrap. Subscribes to the store and re-renders the
 * affected DOM regions on every state change. No virtual DOM — each
 * region is small enough to fully re-render on change.
 */
(function () {
    const { mount, refreshIcons, el } = window.ZenDom;

    const titlebarRoot = document.getElementById('titlebar-root');
    const railRoot = document.getElementById('rail-root');
    const topbarRoot = document.getElementById('topbar-root');
    const viewRoot = document.getElementById('view-root');
    const modalRoot = document.getElementById('modal-root');

    function renderAll() {
        mount(titlebarRoot, window.ZenTitlebar.render());
        mount(railRoot, window.ZenRail.render());
        mount(topbarRoot, window.ZenTopbar.render());

        const state = window.ZenStore.getState();
        const inner = el('div', { class: 'view-inner' }, [window.ZenRouter.resolve(state.view)]);
        mount(viewRoot, inner);

        mount(modalRoot, window.ZenNewProjectModal.render());

        refreshIcons();
    }

    window.ZenStore.subscribe(renderAll);
    if (window.ZenPWA) window.ZenPWA.subscribe(renderAll);
    renderAll();
})();
