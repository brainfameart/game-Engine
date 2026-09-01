/**
 * templates.js
 * Static catalog of project starter templates offered in the New Project modal.
 * Exposed as a global for simplicity since this launcher has no bundler.
 */
window.ZenTemplates = [
    {
        id: 'blank',
        name: 'Blank Canvas',
        icon: 'monitor',
        description: 'An empty environment optimized for pure 2D rendering and custom logic.',
        default: true
    },
    {
        id: 'grid-explorer',
        name: 'Grid Explorer',
        icon: 'compass',
        description: 'Pre-configured tilemap, collision layers, and a 4-way cinematic camera.'
    },
    {
        id: 'platformer',
        name: 'Platformer Kit',
        icon: 'move-diagonal',
        description: 'Kinematic controller, one-way platforms, and coyote-time jump tuning baked in.'
    },
    {
        id: 'top-down-lighting',
        name: 'Top-Down Lit',
        icon: 'sun',
        description: 'URP-style two-phase lighting rig with a controllable day/night cycle.'
    },
    {
        id: 'physics-sandbox',
        name: 'Physics Sandbox',
        icon: 'shapes',
        description: 'Rapier2D bodies, colliders, and joints pre-wired for rapid prototyping.'
    },
    {
        id: 'ui-prototype',
        name: 'UI Prototype',
        icon: 'layout-panel-left',
        description: 'Menu scaffolding and screen-transition scenes with no gameplay systems.'
    }
];
